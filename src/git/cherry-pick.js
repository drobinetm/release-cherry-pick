'use strict';

const simpleGit = require('simple-git');
const logger = require('../utils/logger');
const { GitError } = require('../utils/errors');

const git = simpleGit();

// Cherry-picks `commits` (in order) onto the current branch; when not given, the ones tagged
// "[taskId]" on sourceBranch that aren't on baseBranch (see getCommitsToCherryPick).
async function cherryPickCommits(sourceBranch, taskId, baseBranch = null, commitsToPick = null) {
  logger.info(`Cherry-picking from ${sourceBranch}`);

  try {
    const commits = commitsToPick || await getCommitsToCherryPick(sourceBranch, taskId, baseBranch);

    if (commits.length === 0) {
      logger.warn(`No commits tagged "[${taskId}]" found on ${sourceBranch} that aren't already on ${baseBranch || 'the base branch'}`);
      return { success: true, commitsCherryPicked: 0, commitsAlreadyApplied: 0, conflicts: [], commits: [] };
    }

    logger.info(`Found ${commits.length} commits to cherry-pick`);

    const conflicts = [];
    let pickedCount = 0;
    let emptyCount = 0;

    for (const commit of commits) {
      try {
        // simple-git has no dedicated cherryPick() method; use raw() for the actual git command.
        await git.raw(['cherry-pick', commit.hash]);
        pickedCount++;
        logger.info(`Cherry-picked: ${commit.message.substring(0, 50)}...`);
      } catch (error) {
        const conflictedFiles = await getConflictingFiles();

        if (error.message.includes('is now empty') && conflictedFiles.length === 0) {
          // Not a real conflict: the patch applied cleanly but produced no net change, meaning
          // this commit's changes are already present in the current tree (e.g. the same fix
          // landed some other way). Skip it and keep going — nothing to resolve here.
          logger.warn(`Commit ${commit.hash} is already applied (empty diff) — skipping: ${commit.message.substring(0, 60)}`);
          await git.raw(['cherry-pick', '--skip']);
          emptyCount++;
        } else if (error.message.includes('CONFLICT') || conflictedFiles.length > 0) {
          conflicts.push({
            commit: commit.hash,
            message: commit.message,
            files: conflictedFiles
          });
          logger.error(`Conflict detected in commit: ${commit.hash}`);

          // Abort the cherry-pick and stop touching this branch further
          await git.raw(['cherry-pick', '--abort']);
          break;
        } else {
          throw new GitError(`Cherry-pick failed: ${error.message}`);
        }
      }
    }

    return {
      success: conflicts.length === 0,
      commitsCherryPicked: pickedCount,
      commitsAlreadyApplied: emptyCount,
      conflicts,
      commits: conflicts.length === 0 ? commits : []
    };
  } catch (error) {
    throw new GitError(`Cherry-pick operation failed: ${error.message}`);
  }
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Selects only the commits that belong to this specific task, identified by the team's own
// "[TASK-ID] description" commit message convention — NOT by diffing sourceBranch against a
// base branch. A plain range diff (e.g. staging..sourceBranch) is unreliable in practice:
// branches are often cut from a different/older base than the current staging, so the range
// can include hundreds of unrelated commits, or (if the branch is already absorbed into e.g.
// develop) miss the target commit entirely. Matching by task-id tag, restricted to commits not
// already reachable from baseBranch, reliably isolates just this task's own commit(s) regardless
// of the branch's real topology.
async function getCommitsToCherryPick(sourceBranch, taskId, baseBranch = null) {
  try {
    await git.fetch();

    const args = [
      `origin/${sourceBranch}`,
      `--grep=^\\[${escapeRegex(taskId)}\\]`,
      '--extended-regexp',
      '--regexp-ignore-case'
    ];
    if (baseBranch) {
      args.push('--not', `origin/${baseBranch}`);
    }
    // git log lists newest-first by default; --reverse gives chronological (oldest-first)
    // order, which is required for cherry-picking a sequence of dependent commits correctly.
    args.push('--reverse');

    const log = await git.log(args);
    // git's --grep matches any line of the message, so a commit whose body (not title) has a line
    // starting with "[TASK-ID]" would match too; keep only the ones tagged in the title
    // (simple-git's `message` is the subject line).
    const tagged = taggedSubjectRegex(taskId);
    return log.all
      .filter(commit => tagged.test(commit.message))
      .map(commit => ({
        hash: commit.hash,
        message: commit.message,
        date: commit.date
      }));
  } catch (error) {
    throw new GitError(`Failed to get commits: ${error.message}`);
  }
}

// Title follows the convention for this task: "[TASK-ID] ..." (case-insensitive)
function taggedSubjectRegex(taskId) {
  return new RegExp(`^\\[${escapeRegex(taskId)}\\]`, 'i');
}

// Title follows the convention for *some* task, e.g. "[PB-701] ..."
const ANY_TASK_TAG = /^\[[A-Z]+-[A-Z]*\d[A-Z0-9]*\]/i;

// Commits on sourceBranch (not yet on baseBranch) whose message mentions taskId without following the
// "[TASK-ID] ..." convention — e.g. "PB-700: fix", "(PB-700) fix", "fix PB-700" — so they'd be left
// out of the release silently. Excluded: merge commits (they mention branch names and can't be
// cherry-picked as-is), titles tagged for another task ("[PB-701] ... PB-700"), and IDs that are
// just a prefix of another one (PB-700 vs PB-7000). Commits with no ID at all can't be told apart
// from unrelated history (a branch cut from an old base may carry hundreds), so they're not reported.
async function findLooseTaskCommits(sourceBranch, taskId, baseBranch = null) {
  const id = escapeRegex(taskId);
  const args = [
    `origin/${sourceBranch}`,
    `--grep=(^|[^A-Za-z0-9])${id}([^A-Za-z0-9]|$)`,
    '--extended-regexp',
    '--regexp-ignore-case',
    '--no-merges'
  ];
  if (baseBranch) {
    args.push('--not', `origin/${baseBranch}`);
  }
  args.push('--reverse');

  try {
    const log = await git.log(args);
    const mentions = new RegExp(`(^|[^A-Za-z0-9])${id}(?![A-Za-z0-9])`, 'i');
    // Title or body (a "[TASK-ID] ..." line only in the body doesn't count as tagged, so it's loose
    // too); simple-git splits the subject into `message` and the rest into `body`
    return log.all
      .filter(commit => (mentions.test(commit.message) || mentions.test(commit.body || '')) && !ANY_TASK_TAG.test(commit.message))
      .map(commit => ({ hash: commit.hash, message: commit.message, date: commit.date }));
  } catch (error) {
    throw new GitError(`Failed to look for commits mentioning ${taskId}: ${error.message}`);
  }
}

// Returns `commits` in the order they appear on sourceBranch (oldest first), as cherry-picking a
// mix of tagged and loose commits must follow the branch's history, not the order they were found.
async function orderCommitsByHistory(sourceBranch, commits, baseBranch = null) {
  const args = ['rev-list', '--reverse', `origin/${sourceBranch}`];
  if (baseBranch) {
    args.push('--not', `origin/${baseBranch}`);
  }
  const order = (await git.raw(args)).trim().split('\n');
  const position = new Map(order.map((hash, index) => [hash, index]));
  return [...commits].sort((a, b) => position.get(a.hash) - position.get(b.hash));
}

async function getConflictingFiles() {
  try {
    const status = await git.status();
    return status.conflicted;
  } catch {
    return [];
  }
}

async function abortCherryPick() {
  try {
    await git.raw(['cherry-pick', '--abort']);
    logger.info('Cherry-pick aborted');
    return true;
  } catch (error) {
    logger.error(`Failed to abort cherry-pick: ${error.message}`);
    return false;
  }
}

module.exports = {
  cherryPickCommits,
  getCommitsToCherryPick,
  findLooseTaskCommits,
  orderCommitsByHistory,
  getConflictingFiles,
  abortCherryPick
};
