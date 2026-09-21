'use strict';

const inquirer = require('inquirer');
const logger = require('../utils/logger');

function findDefaultReviewer(members, pattern) {
  const re = new RegExp(pattern, 'i');
  return members.find((m) => re.test(m.username));
}

async function selectReviewer(members, defaultPattern = '^che(i|y)ner$') {
  if (members.length === 0) {
    logger.warn('No GitLab project members found');
    return [];
  }

  const defaultMember = findDefaultReviewer(members, defaultPattern);
  if (!defaultMember) {
    logger.warn('No project member matching "cheiner"/"cheyner" found; no default reviewer preselected');
  }

  const { reviewerUsernames } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'reviewerUsernames',
      message: 'Select MR reviewer(s):',
      pageSize: 15,
      choices: members.map((m) => ({
        name: `${m.name} (@${m.username})`,
        value: m.username,
        checked: !!defaultMember && m.username === defaultMember.username
      }))
    }
  ]);

  return reviewerUsernames;
}

module.exports = { findDefaultReviewer, selectReviewer };
