'use strict';

const inquirer = require('inquirer');
const logger = require('../utils/logger');

// Members to preselect as reviewers: those listed in release.defaultReviewers or, if that list is
// empty, those matching the legacy release.defaultReviewerPattern regex (older config files).
function findDefaultReviewers(members, { defaultReviewers = [], defaultReviewerPattern } = {}) {
  if (defaultReviewers.length > 0) {
    const wanted = new Set(defaultReviewers.map(u => u.toLowerCase()));
    return members.filter(m => wanted.has(m.username.toLowerCase()));
  }
  if (defaultReviewerPattern) {
    const re = new RegExp(defaultReviewerPattern, 'i');
    return members.filter(m => re.test(m.username));
  }
  return [];
}

async function selectReviewer(members, releaseConfig = {}) {
  if (members.length === 0) {
    logger.warn('No GitLab project members found');
    return [];
  }

  const defaults = findDefaultReviewers(members, releaseConfig);
  const missing = (releaseConfig.defaultReviewers || []).filter(
    u => !members.some(m => m.username.toLowerCase() === u.toLowerCase())
  );
  if (missing.length > 0) {
    logger.warn(`Default reviewer(s) not found among project members: ${missing.join(', ')}`);
  }
  const defaultUsernames = new Set(defaults.map(m => m.username));

  const { reviewerUsernames } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'reviewerUsernames',
      message: 'Select MR reviewer(s):',
      pageSize: 15,
      choices: members.map((m) => ({
        name: `${m.name} (@${m.username})`,
        value: m.username,
        checked: defaultUsernames.has(m.username)
      }))
    }
  ]);

  return reviewerUsernames;
}

module.exports = { findDefaultReviewers, selectReviewer };
