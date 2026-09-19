'use strict';

const simpleGit = require('simple-git');
const inquirer = require('inquirer');
const logger = require('../utils/logger');
const { GitError } = require('../utils/errors');

const git = simpleGit();

async function createReleaseBranch(sourceBranch, taskId, stagingBranch = 'staging') {
  const releaseBranchName = `release/${taskId.toLowerCase()}`;

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
      logger.warn(`Release branch ${releaseBranchName} already exists`);
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: `Do you want to overwrite ${releaseBranchName}?`,
          default: false
        }
      ]);

      if (!overwrite) {
        return { success: false, branch: releaseBranchName, reason: 'Branch exists and user chose not to overwrite' };
      }

      // Delete existing branch
      await git.deleteLocalBranch(releaseBranchName, true);
      await git.push(['--delete', 'origin', releaseBranchName]);
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

module.exports = {
  createReleaseBranch,
  checkoutBranch,
  getLatestCommitHash
};
