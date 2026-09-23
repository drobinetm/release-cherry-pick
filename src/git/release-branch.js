'use strict';

const simpleGit = require('simple-git');
const logger = require('../utils/logger');
const { GitError } = require('../utils/errors');

const git = simpleGit();

function buildReleaseBranchName(sourceBranch, branchPrefix = {}) {
  let name = sourceBranch;
  for (const prefix of Object.values(branchPrefix)) {
    if (prefix && prefix !== branchPrefix.release && name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  return `${branchPrefix.release || 'release/'}${name}`;
}

async function createReleaseBranch(sourceBranch, stagingBranch = 'staging', branchPrefix = {}) {
  const releaseBranchName = buildReleaseBranchName(sourceBranch, branchPrefix);

  logger.info(`Creating release branch: ${releaseBranchName}`);

  try {
    // Fetch latest changes
    await git.fetch();

    // Check if release branch already exists (exact name match: a substring check would make
    // e.g. release/PB-12 look taken just because release/PB-123 exists)
    const remoteBranches = await git.branch(['-r']);
    const existsOnOrigin = remoteBranches.all.includes(`origin/${releaseBranchName}`);

    if (existsOnOrigin) {
      // Deleting/overwriting a remote branch here would be a destructive action on shared
      // state (it may already have commits or an open MR) — never do it automatically, even
      // behind a confirmation prompt. Report it and let the user resolve it manually.
      logger.error(`Release branch ${releaseBranchName} already exists on origin. Resolve this manually (delete it, or pick a different branch) and re-run.`);
      return {
        success: false,
        branch: releaseBranchName,
        reason: `Release branch ${releaseBranchName} already exists on origin — needs manual decision by the user`
      };
    }

    // A local-only leftover (e.g. from an earlier run, possibly with manual work on it) is not
    // deleted automatically either — same reasoning, and it's the user's work to decide about.
    const localBranches = await git.branchLocal();
    if (localBranches.all.includes(releaseBranchName)) {
      logger.error(`Release branch ${releaseBranchName} already exists locally. If it's not needed, delete it with \`git branch -D ${releaseBranchName}\` and re-run.`);
      return {
        success: false,
        branch: releaseBranchName,
        reason: `Release branch ${releaseBranchName} already exists locally — delete it (\`git branch -D ${releaseBranchName}\`) if it's not needed and re-run`
      };
    }

    // Checkout staging and create release branch
    await git.checkout(stagingBranch);
    await git.pull('origin', stagingBranch);
    await git.checkoutLocalBranch(releaseBranchName);

    logger.success(`Release branch ${releaseBranchName} created from ${stagingBranch}`);

    return { success: true, created: true, branch: releaseBranchName };
  } catch (error) {
    throw new GitError(`Failed to create release branch: ${error.message}`);
  }
}

async function checkoutBranch(branchName) {
  try {
    await git.checkout(branchName);
    logger.info(`Checked out branch: ${branchName}`);
    return true;
  } catch (error) {
    throw new GitError(`Failed to checkout branch: ${error.message}`);
  }
}

async function getLatestCommitHash(branchName) {
  try {
    const result = await git.log([branchName, '-1']);
    return result.latest.hash;
  } catch (error) {
    throw new GitError(`Failed to get commit hash: ${error.message}`);
  }
}

async function pushBranch(branchName) {
  try {
    await git.push(['-u', 'origin', branchName]);
    logger.success(`Pushed ${branchName} to origin`);
    return true;
  } catch (error) {
    throw new GitError(`Failed to push branch ${branchName}: ${error.message}`);
  }
}

module.exports = {
  buildReleaseBranchName,
  createReleaseBranch,
  checkoutBranch,
  getLatestCommitHash,
  pushBranch
};
