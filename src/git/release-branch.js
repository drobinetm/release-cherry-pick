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

    // Check if release branch already exists
    const branches = await git.branch(['-r']);
    const branchExists = branches.all.some(b => 
      b.includes(releaseBranchName) || b.includes(`origin/${releaseBranchName}`)
    );

    if (branchExists) {
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

    // Checkout staging and create release branch
    await git.checkout(stagingBranch);
    await git.pull('origin', stagingBranch);
    await git.checkoutLocalBranch(releaseBranchName);

    logger.success(`Release branch ${releaseBranchName} created from ${stagingBranch}`);

    return { success: true, branch: releaseBranchName };
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
