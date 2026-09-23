'use strict';

const inquirer = require('inquirer');
const { searchableList } = require('../utils/prompts');
const { loadConfig, saveConfig } = require('./loader');
const { getDefaultConfig } = require('./defaults');
const { validateConfigPartial } = require('./validator');
const logger = require('../utils/logger');
const {
  DEFAULT_PROVIDER,
  loadProviderCatalog,
  getProviderChoices,
  getEnvKeyNames,
  findEnvValue,
  resolveBaseURL,
  listModelsForProvider
} = require('./ai-providers');

const CUSTOM_MODEL_CHOICE = '__custom_model__';
const BACK_CHOICE = '__back__';
const RESTORE_SAVED_CHOICE = '__restore_saved__';
const RESET_MODEL_CHOICE = '__reset_model__';

// Sequential flow like OpenCode's /connect: list all providers → enter API key
// (skipped when the env var is already set) → connect and list that provider's models.
// Supports going back (model → provider) and restoring the previously saved selection.
async function promptAiProviderAndModel(config) {
  const catalog = await loadProviderCatalog();
  const choices = getProviderChoices(catalog);
  const savedProvider = (config.ai && config.ai.provider) || DEFAULT_PROVIDER;
  const savedModel = config.ai && config.ai.model;
  const hasSaved = Boolean(config.ai && config.ai.provider && config.ai.model);

  for (;;) {
    const providerChoices = [...choices];
    if (hasSaved) {
      providerChoices.unshift({
        name: `↺ Restore saved selection (${config.ai.provider} / ${config.ai.model})`,
        value: RESTORE_SAVED_CHOICE
      });
    }

    const { aiProvider } = await inquirer.prompt([
      searchableList({
        name: 'aiProvider',
        message: `AI provider (${choices.length} available), type to search:`,
        pageSize: 20,
        default: hasSaved
          ? RESTORE_SAVED_CHOICE
          : (choices.some((choice) => choice.value === savedProvider) ? savedProvider : undefined)
      }, providerChoices)
    ]);

    if (aiProvider === RESTORE_SAVED_CHOICE) {
      logger.info('Restored saved AI selection');
      return {
        provider: config.ai.provider,
        model: config.ai.model,
        apiKey: config.ai.apiKey || '',
        baseURL: config.ai.baseURL || ''
      };
    }

    const provider = catalog[aiProvider] || { id: aiProvider, name: aiProvider, env: '', models: {} };
    const envKeyNames = getEnvKeyNames(provider);
    const envValue = findEnvValue(envKeyNames);
    const savedKey = config.ai && config.ai.provider === aiProvider ? config.ai.apiKey || '' : '';

    let apiKey = envValue || savedKey;
    if (!apiKey) {
      const { enteredKey } = await inquirer.prompt([
        {
          type: 'input',
          name: 'enteredKey',
          message: envKeyNames.length
            ? `API key for ${provider.name} (env ${envKeyNames.join(' or ')} not set):`
            : `API key for ${provider.name} (leave blank if not required):`,
          mask: '*',
          when: () => true,
          filter: (value) => (value ? String(value).trim() : '')
        }
      ]);
      apiKey = enteredKey || '';
    }

    const baseURL = resolveBaseURL(aiProvider, provider, config);

    if (apiKey || baseURL) {
      logger.info(`Connecting to ${provider.name || aiProvider} to list models...`);
    }
    const { models, source } = await listModelsForProvider(aiProvider, provider, apiKey, baseURL);

    if (source === 'live') {
      logger.success(`Connected to ${provider.name || aiProvider}: ${models.length} model(s) available`);
    } else if (source === 'catalog') {
      logger.warn(`Could not reach ${provider.name || aiProvider} API; showing models.dev catalog (${models.length} model(s))`);
    } else {
      logger.warn(`No models found for ${provider.name || aiProvider}; you can enter a model ID manually`);
    }

    const modelChoices = [...models];
    if (savedModel && !modelChoices.includes(savedModel)) {
      modelChoices.unshift(savedModel);
    }
    modelChoices.push({ name: 'Custom model (enter manually)', value: CUSTOM_MODEL_CHOICE });
    modelChoices.push({
      name: `← Back (choose another provider)`,
      value: BACK_CHOICE
    });
    if (savedModel) {
      modelChoices.push({
        name: `↺ Reset to saved model (${savedModel})`,
        value: RESET_MODEL_CHOICE
      });
    }

    const defaultModel = savedModel && modelChoices.includes(savedModel)
      ? savedModel
      : (models[0] || CUSTOM_MODEL_CHOICE);

    const { aiModelChoice } = await inquirer.prompt([
      searchableList({
        name: 'aiModelChoice',
        message: `Models from ${provider.name || aiProvider}, type to search:`,
        pageSize: 15,
        default: defaultModel
      }, modelChoices)
    ]);

    if (aiModelChoice === BACK_CHOICE) {
      continue;
    }

    if (aiModelChoice === RESET_MODEL_CHOICE) {
      logger.info(`Reset model to saved selection: ${savedModel}`);
      return {
        provider: aiProvider,
        model: savedModel,
        apiKey,
        baseURL: baseURL || ''
      };
    }

    let model = aiModelChoice;
    if (aiModelChoice === CUSTOM_MODEL_CHOICE) {
      const { aiModelCustom } = await inquirer.prompt([
        {
          type: 'input',
          name: 'aiModelCustom',
          message: 'Custom AI model ID (leave blank to go back):',
          filter: (value) => (value ? String(value).trim() : '')
        }
      ]);
      const custom = aiModelCustom || '';
      if (!custom) {
        continue;
      }
      model = custom;
    }

    return {
      provider: aiProvider,
      model,
      apiKey,
      baseURL: baseURL || ''
    };
  }
}

// If AI is enabled but provider/model were never saved, ask for them and persist.
async function ensureAiSettings(config) {
  if (!config || !config.ai || !config.ai.enabled) {
    return config;
  }
  if (config.ai.provider && config.ai.model) {
    return config;
  }

  logger.warn('AI is enabled but provider/model is not saved in configuration');
  const selection = await promptAiProviderAndModel(config);

  config.ai.provider = selection.provider;
  config.ai.model = selection.model;
  config.ai.apiKey = selection.apiKey || (config.ai.apiKey || '');
  config.ai.baseURL = selection.baseURL || (config.ai.baseURL || '');
  saveConfig(config);
  logger.success('AI provider and model saved to configuration');
  return config;
}

async function setupWizard() {
  logger.header('Configuration Setup');

  const existingConfig = loadConfig();
  const config = existingConfig || getDefaultConfig();
  if (!config.release || !Array.isArray(config.release.branches)) {
    config.release = { ...(config.release || {}), branches: [] };
  }
  if (!config.ai || typeof config.ai !== 'object') {
    config.ai = getDefaultConfig().ai;
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
      type: 'input',
      name: 'gitlabToken',
      message: 'GitLab personal access token, scope "api" (leave blank to keep current / use GITLAB_TOKEN env):',
      mask: '*',
      when: () => true,
      filter: (value) => (value ? String(value).trim() : ''),
      validate: (value) =>
        value === '' || value === undefined || value.length >= 8 || 'Token looks too short (min 8 chars)'
    },
    {
      type: 'confirm',
      name: 'aiEnabled',
      message: 'Enable AI for MR titles/descriptions?',
      default: config.ai.enabled
    }
  ];

  const answers = await inquirer.prompt(questions);

  let aiSelection = null;
  if (answers.aiEnabled) {
    aiSelection = await promptAiProviderAndModel(config);
  }

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
      host: answers.gitlabHost,
      token: answers.gitlabToken || (config.gitlab.token || '')
    },
    ai: answers.aiEnabled && aiSelection
      ? {
          enabled: true,
          provider: aiSelection.provider,
          apiKey: aiSelection.apiKey || '',
          model: aiSelection.model,
          baseURL: aiSelection.baseURL || ''
        }
      : {
          enabled: false,
          provider: config.ai.provider || DEFAULT_PROVIDER,
          apiKey: config.ai.apiKey || '',
          model: config.ai.model || '',
          baseURL: config.ai.baseURL || ''
        },
    release: {
      ...config.release
    }
  };

  const { reviewAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'reviewAction',
      message: 'Review configuration:',
      choices: [
        { name: '✔ Save configuration', value: 'save' },
        { name: '← Back (edit again from initial values)', value: 'back' },
        { name: '✖ Cancel (discard changes)', value: 'cancel' }
      ],
      default: 'save'
    }
  ]);

  if (reviewAction === 'back') {
    logger.info('Returning to the start of the setup wizard');
    return setupWizard();
  }

  if (reviewAction === 'cancel') {
    logger.warn('Configuration setup cancelled; no changes were saved');
    return existingConfig;
  }

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

module.exports = {
  setupWizard,
  ensureAiSettings,
  promptAiProviderAndModel
};
