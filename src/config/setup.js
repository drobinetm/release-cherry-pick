'use strict';

const inquirer = require('inquirer');
const { loadConfig, saveConfig, configExists } = require('./loader');
const { getDefaultConfig } = require('./defaults');
const { validateConfigPartial } = require('./validator');
const logger = require('../utils/logger');

async function setupWizard() {
  logger.header('Configuration Setup');

  const existingConfig = loadConfig();
  const config = existingConfig || getDefaultConfig();

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
    }
  ];

  const answers = await inquirer.prompt(questions);

  const newConfig = {
    git: {
      stagingBranch: answers.stagingBranch,
      branchPrefix: {
        feature: answers.featurePrefix,
        hotfix: answers.hotfixPrefix,
        release: answers.releasePrefix
      }
    },
    gitlab: {
      host: answers.gitlabHost
    },
    ai: {
      enabled: answers.aiEnabled,
      provider: config.ai.provider,
      apiKey: answers.aiApiKey || config.ai.apiKey,
      model: answers.aiModel || config.ai.model
    },
    release: config.release
  };

  try {
    validateConfigPartial(newConfig);
    saveConfig(newConfig);
    logger.success('Configuration saved successfully!');
    return newConfig;
  } catch (error) {
    logger.error(error.message);
    return null;
  }
}

module.exports = { setupWizard };
