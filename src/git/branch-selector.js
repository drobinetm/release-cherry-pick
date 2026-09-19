'use strict';

const inquirer = require('inquirer');
const simpleGit = require('simple-git');
const logger = require('../utils/logger');

const git = simpleGit();

async function selectBranchesInteractively() {
  logger.header('Branch Selection');

  const branches = await getRemoteBranches();

  if (branches.length === 0) {
    logger.warn('No feature or hotfix branches found');
    return [];
  }

  const { selectedBranches } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedBranches',
      message: 'Select branches for release:',
      choices: branches.map(branch => ({
        name: branch,
        value: branch
      })),
      pageSize: 15
    }
  ]);

  return selectedBranches;
}

async function getRemoteBranches() {
  try {
    const result = await git.branch(['-r']);
    const branches = result.all
      .filter(branch => branch.includes('origin/feature/') || branch.includes('origin/hotfix/'))
      .map(branch => branch.replace('origin/', ''))
      .sort();

    return branches;
  } catch (error) {
    logger.error(`Error getting branches: ${error.message}`);
    return [];
  }
}

async function searchBranches(searchTerm) {
  const branches = await getRemoteBranches();
  return branches.filter(branch => 
    branch.toLowerCase().includes(searchTerm.toLowerCase())
  );
}

async function validateBranchExists(branchName) {
  try {
    const result = await git.branch(['-r']);
    return result.all.some(branch => 
      branch === `origin/${branchName}` || branch === branchName
    );
  } catch (error) {
    return false;
  }
}

module.exports = {
  selectBranchesInteractively,
  getRemoteBranches,
  searchBranches,
  validateBranchExists
};
