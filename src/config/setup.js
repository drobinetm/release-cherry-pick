'use strict';

const inquirer = require('inquirer');
const { loadConfig, saveConfig } = require('./loader');
const { getDefaultConfig } = require('./defaults');
const { validateConfig } = require('./validator');
const glab = require('../glab/client');
const { findDefaultReviewers } = require('../gitlab/reviewer-selector');
const logger = require('../utils/logger');

async function setupWizard() {
  logger.header('Configuration Setup');

  // Start from the existing config (merged with defaults) without validating it, so the wizard
  // can also be used to repair an invalid file.
  let config;
  try {
    config = loadConfig({ validate: false }) || getDefaultConfig();
  } catch (error) {
    logger.warn(`${error.message}\nStarting from the default configuration instead.`);
    config = getDefaultConfig();
  }

  const questions = [
    {
      type: 'input',
      name: 'stagingBranch',
      message: 'Staging branch name:',
      default: config.git.stagingBranch
    },
    {
      type: 'input',
      name: 'featurePrefix',
      message: 'Feature branch prefix:',
      default: config.git.branchPrefix.feature
    },
    {
      type: 'input',
      name: 'hotfixPrefix',
      message: 'Hotfix branch prefix:',
      default: config.git.branchPrefix.hotfix
    },
    {
      type: 'input',
      name: 'releasePrefix',
      message: 'Release branch prefix:',
      default: config.git.branchPrefix.release
    },
    {
      type: 'input',
      name: 'gitlabHost',
      message: 'GitLab hostname (leave blank for gitlab.com):',
      default: config.gitlab.host
    },
    {
      type: 'confirm',
      name: 'aiEnabled',
      message: 'Enable AI (Anthropic Claude) for MR titles/descriptions?',
      default: config.ai.enabled
    },
    {
      type: 'input',
      name: 'aiApiKey',
      message: 'Anthropic API key (leave blank to use ANTHROPIC_API_KEY env var):',
      mask: '*',
      when: (answers) => answers.aiEnabled,
      default: config.ai.apiKey
    },
    {
      type: 'input',
      name: 'aiModel',
      message: 'Anthropic model:',
      when: (answers) => answers.aiEnabled,
      default: config.ai.model
    },
    {
      type: 'confirm',
      name: 'autoCreateMR',
      message: 'Push release branches and create GitLab MRs automatically? (no = only prepare branches locally)',
      default: config.release.autoCreateMR
    },
    {
      type: 'input',
      name: 'mrTitleFormat',
      message: 'MR title template when AI is off ({taskId} and {description} are replaced):',
      when: (answers) => answers.autoCreateMR,
      default: config.release.mrTitleFormat
    },
    {
      type: 'confirm',
      name: 'mrSquash',
      message: 'Check "Squash commits" on created MRs?',
      when: (answers) => answers.autoCreateMR,
      default: config.release.mrSquash
    },
    {
      type: 'confirm',
      name: 'mrRemoveSourceBranch',
      message: 'Check "Delete source branch" on created MRs?',
      when: (answers) => answers.autoCreateMR,
      default: config.release.mrRemoveSourceBranch
    }
  ];

  const answers = await inquirer.prompt(questions);

  // Copy of the loaded config, so any option the wizard doesn't ask about is kept untouched
  const newConfig = JSON.parse(JSON.stringify(config));
  newConfig.git.stagingBranch = answers.stagingBranch;
  newConfig.git.branchPrefix = {
    ...newConfig.git.branchPrefix,
    feature: answers.featurePrefix,
    hotfix: answers.hotfixPrefix,
    release: answers.releasePrefix
  };
  newConfig.gitlab.host = answers.gitlabHost;
  newConfig.ai.enabled = answers.aiEnabled;
  newConfig.ai.apiKey = answers.aiApiKey || config.ai.apiKey;
  newConfig.ai.model = answers.aiModel || config.ai.model;
  newConfig.release.autoCreateMR = answers.autoCreateMR;
  if (answers.autoCreateMR) {
    newConfig.release.mrTitleFormat = answers.mrTitleFormat;
    newConfig.release.mrSquash = answers.mrSquash;
    newConfig.release.mrRemoveSourceBranch = answers.mrRemoveSourceBranch;

    await selectDefaultMembers(newConfig);
  }

  try {
    validateConfig(newConfig);
    saveConfig(newConfig);
    logger.success('Configuration saved successfully!');
    return newConfig;
  } catch (error) {
    logger.error(error.message);
    return null;
  }
}

// Sets release.defaultReviewers / release.defaultAssignees, picking from the real GitLab project
// members via glab when possible, or from manually typed usernames otherwise.
async function selectDefaultMembers(config) {
  const release = config.release;
  const members = await fetchProjectMembers(config);

  if (members) {
    const reviewerDefaults = findDefaultReviewers(members, release).map(m => m.username);
    release.defaultReviewers = await pickMembers(
      'defaultReviewers',
      members,
      reviewerDefaults,
      release.defaultReviewers,
      'Default MR reviewer(s) (preselected in each MR\'s reviewer prompt):'
    );
    release.defaultAssignees = await pickMembers(
      'defaultAssignees',
      members,
      release.defaultAssignees,
      release.defaultAssignees,
      'Default MR assignee(s) (assigned automatically to every MR):'
    );
  } else {
    release.defaultReviewers = await askUsernames('defaultReviewers', 'Default MR reviewer usernames (comma-separated, blank for none):', release.defaultReviewers);
    release.defaultAssignees = await askUsernames('defaultAssignees', 'Default MR assignee usernames (comma-separated, blank for none):', release.defaultAssignees);
  }

  // Reviewers are now an explicit list; the legacy regex has been migrated into it
  delete release.defaultReviewerPattern;
}

async function fetchProjectMembers(config) {
  try {
    await glab.ensureAuthenticated(config);
    logger.info('Loading GitLab project members...');
    const members = await glab.getProjectMembers();
    if (members.length === 0) {
      logger.warn('The GitLab project has no members to choose from; enter usernames manually instead.');
      return null;
    }
    return members;
  } catch (error) {
    logger.warn(`Could not load GitLab project members (${error.message}); enter usernames manually instead.`);
    return null;
  }
}

async function pickMembers(name, members, checkedUsernames, configuredUsernames, message) {
  const checked = new Set(checkedUsernames.map(u => u.toLowerCase()));
  const choices = members.map(m => ({
    name: `${m.name} (@${m.username})`,
    value: m.username,
    checked: checked.has(m.username.toLowerCase())
  }));

  // Keep previously configured usernames that are no longer project members visible, so they
  // aren't dropped silently — the user decides whether to keep them.
  for (const username of configuredUsernames) {
    if (!members.some(m => m.username.toLowerCase() === username.toLowerCase())) {
      choices.push({ name: `@${username} (not found among project members)`, value: username, checked: true });
    }
  }

  const answers = await inquirer.prompt([
    { type: 'checkbox', name, message, pageSize: 15, choices }
  ]);
  return answers[name];
}

async function askUsernames(name, message, current) {
  const answers = await inquirer.prompt([
    { type: 'input', name, message, default: current.join(', ') }
  ]);
  return String(answers[name])
    .split(',')
    .map(u => u.trim().replace(/^@/, ''))
    .filter(Boolean);
}

module.exports = { setupWizard };
