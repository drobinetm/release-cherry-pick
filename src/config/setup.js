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
      name: 'gitlabUrl',
      message: 'GitLab URL:',
      default: config.gitlab.url
    },
    {
      type: 'password',
      name: 'gitlabToken',
      message: 'GitLab token:',
      mask: '*',
      default: config.gitlab.token
    },
    {
      type: 'input',
      name: 'gitlabProjectId',
      message: 'GitLab Project ID:',
      default: config.gitlab.projectId
    },
    {
      type: 'confirm',
      name: 'aiEnabled',
      message: 'Enable AI for MR descriptions?',
      default: config.ai.enabled
    },
    {
      type: 'input',
      name: 'aiApiKey',
      message: 'AI API Key:',
      mask: '*',
      when: (answers) => answers.aiEnabled,
      default: config.ai.apiKey
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
      url: answers.gitlabUrl,
      token: answers.gitlabToken,
      projectId: answers.gitlabProjectId
    },
    ai: {
      enabled: answers.aiEnabled,
      provider: config.ai.provider,
      apiKey: answers.aiApiKey || config.ai.apiKey
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
