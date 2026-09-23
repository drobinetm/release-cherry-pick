'use strict';

const simpleGit = require('simple-git');
const logger = require('../utils/logger');
const { GitError } = require('../utils/errors');

const git = simpleGit();

async function cherryPickCommits(sourceBranch, taskId, baseBranch = null) {
  logger.info(`Cherry-picking from ${sourceBranch}`);

  try {
    // Get commits from source branch
    const commits = await getCommitsToCherryPick(sourceBranch, taskId, baseBranch);

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
    return log.all.map(commit => ({
      hash: commit.hash,
      message: commit.message,
      date: commit.date
    }));
  } catch (error) {
    throw new GitError(`Failed to get commits: ${error.message}`);
  }
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
  getConflictingFiles,
  abortCherryPick
};
