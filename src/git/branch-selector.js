'use strict';

const inquirer = require('inquirer');
const simpleGit = require('simple-git');
const logger = require('../utils/logger');
const { searchableCheckbox } = require('../utils/prompts');
const { defaultConfig } = require('../config/defaults');

const git = simpleGit();

// Prefixes of the branches a release can be cut from (every configured prefix except release)
// (falls back to the defaults when none are configured).
function getSourcePrefixes(branchPrefix) {
  const prefixes = Object.entries(branchPrefix || {})
    .filter(([type, prefix]) => type !== 'release' && prefix)
    .map(([, prefix]) => prefix);
  return prefixes.length > 0 ? prefixes : getSourcePrefixes(defaultConfig.git.branchPrefix);
}

async function selectBranchesInteractively(branchPrefix) {
  logger.header('Branch Selection');

  const branches = await getRemoteBranches(branchPrefix);

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

async function getRemoteBranches(branchPrefix) {
  const prefixes = getSourcePrefixes(branchPrefix);
  try {
    await git.fetch();
    const result = await git.branch(['-r']);
    const branches = result.all
      .filter(branch => branch.startsWith('origin/'))
      .map(branch => branch.replace('origin/', ''))
      .filter(branch => prefixes.some(prefix => branch.startsWith(prefix)))
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
async function resolveBranchNameForTaskId(taskId, branches = null, branchPrefix) {
  const list = branches || (await getRemoteBranches(branchPrefix));
  const prefixes = getSourcePrefixes(branchPrefix).map(escapeRegex).join('|');
  const re = new RegExp(`^(?:${prefixes})${escapeRegex(taskId)}(?:[-_]|$)`, 'i');
  return list.filter(branch => re.test(branch));
}

async function searchBranches(searchTerm, branchPrefix) {
  const branches = await getRemoteBranches(branchPrefix);
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
  } catch {
    return false;
  }
}

module.exports = {
  getSourcePrefixes,
  selectBranchesInteractively,
  getRemoteBranches,
  resolveBranchNameForTaskId,
  searchBranches,
  validateBranchExists
};
