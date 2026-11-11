'use strict';

const inquirer = require('inquirer');
const { createGit } = require('./instance');
const logger = require('../utils/logger');
const { searchableCheckbox } = require('../utils/prompts');
const { defaultConfig } = require('../config/defaults');

const git = createGit();

// Prefixes of the branches a release can be cut from (every configured prefix except release)
// (falls back to the defaults when none are configured).
function getSourcePrefixes(branchPrefix) {
  const prefixes = Object.entries(branchPrefix || {})
    .filter(([type, prefix]) => type !== 'release' && prefix)
    .map(([, prefix]) => prefix);
  return prefixes.length > 0 ? prefixes : getSourcePrefixes(defaultConfig.git.branchPrefix);
}

async function selectBranchesInteractively(branchPrefix, branches = null) {
  logger.header('Branch Selection');

  const list = branches || (await getRemoteBranches(branchPrefix));

  if (list.length === 0) {
    logger.warn('No feature or hotfix branches found');
    return [];
  }

  const { selectedBranches } = await inquirer.prompt([
    searchableCheckbox({
      name: 'selectedBranches',
      message: 'Select branches for release (type to search):',
      pageSize: 15
    }, list)
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

async function getLocalBranches(branchPrefix) {
  const prefixes = getSourcePrefixes(branchPrefix);
  try {
    const result = await git.branchLocal();
    return result.all
      .filter(branch => prefixes.some(prefix => branch.startsWith(prefix)))
      .sort();
  } catch (error) {
    logger.error(`Error getting local branches: ${error.message}`);
    return [];
  }
}

// Every source branch the release can be cut from, keyed by name: { local, remote } says where it
// exists. In 'local' mode both local branches and origin's are listed (a branch only on origin is
// still usable as a fallback); in 'remote' mode only origin's, as before local mode existed.
async function getBranchCatalog(branchPrefix, mode = 'local') {
  const catalog = new Map();
  const remote = await getRemoteBranches(branchPrefix);
  for (const name of remote) {
    catalog.set(name, { local: false, remote: true });
  }
  if (mode === 'local') {
    for (const name of await getLocalBranches(branchPrefix)) {
      catalog.set(name, { local: true, remote: catalog.has(name) });
    }
  }
  return catalog;
}

// How many branches use each prefix ("feature/" -> 124), counting local and origin branches once
// per name. Reads the refs already present (no fetch), so it's instant and works offline; used by
// the setup wizard to suggest the prefixes this repo really uses. {} outside a git repo.
async function countBranchesByPrefix() {
  try {
    const out = await git.raw(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin']);
    const names = new Set();
    for (const ref of out.split('\n').map(line => line.trim())) {
      const name = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length)
        : ref.startsWith('refs/remotes/origin/') ? ref.slice('refs/remotes/origin/'.length)
          : null;
      if (name && name !== 'HEAD') names.add(name);
    }

    const counts = {};
    for (const name of names) {
      const slash = name.indexOf('/');
      if (slash > 0) {
        const prefix = name.slice(0, slash + 1);
        counts[prefix] = (counts[prefix] || 0) + 1;
      }
    }
    return counts;
  } catch {
    return {};
  }
}

// Number of commits reachable from `to` but not from `from` (0 if either ref is unknown).
async function countCommitsBetween(from, to) {
  try {
    const out = await git.raw(['rev-list', '--count', `${from}..${to}`]);
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
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
  getBranchCatalog,
  countBranchesByPrefix,
  countCommitsBetween,
  getLocalBranches,
  getRemoteBranches,
  resolveBranchNameForTaskId,
  searchBranches,
  validateBranchExists
};
