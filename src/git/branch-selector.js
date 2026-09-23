'use strict';

const inquirer = require('inquirer');
const simpleGit = require('simple-git');
const logger = require('../utils/logger');
const { searchableCheckbox } = require('../utils/prompts');

const git = simpleGit();

async function selectBranchesInteractively() {
  logger.header('Branch Selection');

  const branches = await getRemoteBranches();

  if (branches.length === 0) {
    logger.warn('No feature or hotfix branches found');
    return [];
  }

  const { selectedBranches } = await inquirer.prompt([
    searchableCheckbox({
      name: 'selectedBranches',
      message: 'Select branches for release (type to search):',
      pageSize: 15
    }, branches)
  ]);

  return selectedBranches;
}

async function getRemoteBranches() {
  try {
    await git.fetch();
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

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Finds real remote branch(es) whose feature/hotfix name starts with the given task ID
// (case-insensitive), e.g. taskId "PB-I3245" matches "hotfix/PB-I3245-favicon-incorrect-payments".
async function resolveBranchNameForTaskId(taskId, branches = null) {
  const list = branches || (await getRemoteBranches());
  const re = new RegExp(`^(feature|hotfix)/${escapeRegex(taskId)}(?:[-_]|$)`, 'i');
  return list.filter(branch => re.test(branch));
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
  resolveBranchNameForTaskId,
  searchBranches,
  validateBranchExists
};
