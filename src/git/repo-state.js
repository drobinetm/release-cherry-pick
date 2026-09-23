'use strict';

const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const logger = require('../utils/logger');
const { GitError } = require('../utils/errors');

const git = simpleGit();

// Checks for .git/CHERRY_PICK_HEAD directly: `git rev-parse -q --verify CHERRY_PICK_HEAD` fails
// silently (no stderr), and simple-git only rejects when stderr has content, so it can't be used.
async function isCherryPickInProgress() {
  try {
    const gitPath = (await git.raw(['rev-parse', '--git-path', 'CHERRY_PICK_HEAD'])).trim();
    return fs.existsSync(path.resolve(process.cwd(), gitPath));
  } catch {
    return false;
  }
}

// Preflight before the release touches any branch: refuses to start with uncommitted changes to
// tracked files (checking out staging would fail or carry them onto a release branch) or with a
// cherry-pick in progress. Untracked files are fine — e.g. the tool's own .release-cherry-pick.json.
// Returns where HEAD is now (branch name, or commit hash if detached) so it can be restored later.
async function captureStartingPoint() {
  let status;
  try {
    status = await git.status();
  } catch (error) {
    throw new GitError(`Not a usable git repository here: ${error.message}`);
  }

  if (await isCherryPickInProgress()) {
    throw new GitError('A cherry-pick is in progress in this repository. Finish it (`git cherry-pick --continue`) or abort it (`git cherry-pick --abort`), then re-run.');
  }

  const changed = status.files.filter(file => file.index !== '?' && file.working_dir !== '?');
  if (changed.length > 0) {
    const list = changed.slice(0, 10).map(file => `  - ${file.path}`).join('\n');
    const more = changed.length > 10 ? `\n  ...and ${changed.length - 10} more` : '';
    throw new GitError(`You have uncommitted changes. Commit or stash them before running a release:\n${list}${more}`);
  }

  if (status.detached) {
    const hash = (await git.revparse(['HEAD'])).trim();
    return { ref: hash, label: `detached HEAD at ${hash.slice(0, 8)}` };
  }
  return { ref: status.current, label: status.current };
}

// Puts the repo back where the release started and deletes the empty release branches this run
// created (conflicts, skipped and failed tasks). Never throws: each step only warns on failure, so
// it's safe to call from a finally block after an error.
async function restoreStartingPoint(startingPoint, branchesToDelete = []) {
  if (await isCherryPickInProgress()) {
    try {
      await git.raw(['cherry-pick', '--abort']);
      logger.warn('Aborted a cherry-pick left in progress');
    } catch (error) {
      logger.warn(`Could not abort the cherry-pick in progress: ${error.message}`);
    }
  }

  let restored = false;
  try {
    await git.checkout(startingPoint.ref);
    restored = true;
    logger.info(`Returned to ${startingPoint.label}`);
  } catch (error) {
    logger.warn(`Could not return to ${startingPoint.label}: ${error.message}`);
  }

  for (const branch of branchesToDelete) {
    if (!restored) {
      logger.warn(`Kept empty local release branch ${branch} (could not leave it safely)`);
      continue;
    }
    try {
      await git.raw(['branch', '-D', branch]);
      logger.info(`Deleted empty local release branch ${branch}`);
    } catch (error) {
      logger.warn(`Could not delete local release branch ${branch}: ${error.message}`);
    }
  }
}

// How long to wait after Ctrl+C for `work` to reach a checkpoint before cleaning up anyway. Needed
// when it's blocked on an Inquirer prompt: Inquirer closes the prompt and re-sends SIGINT, but the
// prompt's promise never settles, so `work` never gets to its checkpoint.
const INTERRUPT_GRACE_MS = 2000;

// Runs `work(signal)` so that Ctrl+C still restores the repository. The first Ctrl+C sets
// `signal.interrupted` — `work` must check it between steps and stop — then, once `work` has
// stopped (or after the grace period), runs `cleanup` and exits with code 130. A second Ctrl+C
// exits right away. Without interruption, `cleanup` runs once when `work` finishes or throws.
async function runInterruptible(work, cleanup) {
  const signal = { interrupted: false };
  let cleanupPromise = null;
  const cleanupOnce = () => {
    cleanupPromise = cleanupPromise || Promise.resolve().then(cleanup);
    return cleanupPromise;
  };

  let markWorkStopped;
  const workStopped = new Promise(resolve => { markWorkStopped = resolve; });

  const onSigint = () => {
    if (signal.interrupted) {
      logger.error('Forced exit — the repository may need manual cleanup (check `git status`)');
      process.exit(130);
    }
    signal.interrupted = true;
    logger.warn('Interrupted — restoring the repository before exiting (press Ctrl+C again to force quit)...');
    const grace = new Promise(resolve => setTimeout(resolve, INTERRUPT_GRACE_MS));
    Promise.race([workStopped, grace])
      .then(cleanupOnce)
      .finally(() => process.exit(130));
  };
  process.on('SIGINT', onSigint);

  // On Ctrl+C during a prompt, Inquirer closes it and re-sends the signal with
  // process.kill(process.pid, 'SIGINT'). On Windows, process.kill terminates the process
  // unconditionally (no handlers run), so while `work` runs, turn that self-sent SIGINT into a
  // regular SIGINT event instead.
  const realKill = process.kill;
  process.kill = function (pid, sig) {
    if (pid === process.pid && sig === 'SIGINT') {
      process.emit('SIGINT', 'SIGINT');
      return true;
    }
    return realKill.apply(process, arguments);
  };

  try {
    return await work(signal);
  } finally {
    markWorkStopped();
    await cleanupOnce();
    if (signal.interrupted) {
      // Don't return to the caller (it would go on to the summary prompts); the handler exits
      process.exit(130);
    }
    process.kill = realKill;
    process.removeListener('SIGINT', onSigint);
  }
}

module.exports = {
  captureStartingPoint,
  restoreStartingPoint,
  runInterruptible
};
