'use strict';

const inquirer = require('inquirer');
const { searchableList, searchableCheckbox } = require('../utils/prompts');
const { countBranchesByPrefix } = require('../git/branch-selector');
const { loadConfig, saveConfig, getConfigPath } = require('./loader');
const { getDefaultConfig } = require('./defaults');
const { validateConfig } = require('./validator');
const gitlab = require('../gitlab/client');
const { findDefaultReviewers } = require('../gitlab/reviewer-selector');
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
const ADD_PREFIX_CHOICE = '__add_prefix__';

// Offered in the source-prefix list even when this repo has no branch using them yet
const COMMON_SOURCE_PREFIXES = ['feature/', 'hotfix/', 'bugfix/', 'feat/', 'fix/', 'chore/'];

// "task" -> "task/": prefixes always end in a slash, as the branch name follows it
function normalizePrefix(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

// Key a prefix is saved under in git.branchPrefix: "feat/" -> "feat"
function prefixKey(prefix) {
  return prefix.replace(/\/+$/, '');
}

function validateSourcePrefix(prefix, known, releasePrefix) {
  if (!prefix) return 'Enter a prefix, e.g. task/';
  if (/\s/.test(prefix)) return 'Prefixes cannot contain spaces';
  if (prefix === releasePrefix || prefixKey(prefix) === 'release') {
    return `${prefix} is reserved for release branches`;
  }
  if (known.includes(prefix)) return `${prefix} is already in the list`;
  return true;
}

// Multi-select of the prefixes source branches can have (everything but the release prefix):
// the configured ones (checked), the ones this repo's branches really use (with how many branches
// each), and the common ones; "+ Add another prefix…" asks for a new one and shows the list again.
// Returns them as git.branchPrefix entries, keeping the key each configured prefix already had.
async function promptSourcePrefixes(config) {
  const current = config.git.branchPrefix || {};
  const releasePrefix = current.release || getDefaultConfig().git.branchPrefix.release;
  const configured = Object.entries(current)
    .filter(([type, prefix]) => type !== 'release' && prefix)
    .map(([, prefix]) => prefix);
  const counts = await countBranchesByPrefix();
  // A prefix seen on a single branch is usually noise (a slash inside a branch name, a typo like
  // "realease/"), so only prefixes shared by 2+ branches are suggested; the configured and common
  // ones are always listed.
  const detected = Object.keys(counts)
    .filter(prefix => prefix !== releasePrefix && counts[prefix] >= 2)
    .sort((a, b) => counts[b] - counts[a]);
  const known = [...new Set([...configured, ...detected, ...COMMON_SOURCE_PREFIXES])];
  let selected = configured.length > 0 ? configured : ['feature/', 'hotfix/'];

  for (;;) {
    const width = Math.max(...known.map(prefix => prefix.length));
    const choices = known.map(prefix => {
      const count = counts[prefix] || 0;
      return {
        name: `${prefix.padEnd(width)}  ${count} branch${count === 1 ? '' : 'es'}`,
        value: prefix,
        checked: selected.includes(prefix)
      };
    });
    choices.push({ name: '+ Add another prefix…', value: ADD_PREFIX_CHOICE });

    const { sourcePrefixes } = await inquirer.prompt([
      searchableCheckbox({
        name: 'sourcePrefixes',
        message: 'Source branch prefixes (space to toggle, type to search):',
        pageSize: 15,
        default: selected
      }, choices)
    ]);

    selected = sourcePrefixes.filter(prefix => prefix !== ADD_PREFIX_CHOICE);
    if (!sourcePrefixes.includes(ADD_PREFIX_CHOICE)) {
      if (selected.length > 0) break;
      logger.warn('Select at least one source branch prefix');
      continue;
    }

    const { newPrefix } = await inquirer.prompt([
      {
        type: 'input',
        name: 'newPrefix',
        message: 'New source branch prefix, e.g. task/ (blank to go back):',
        filter: normalizePrefix,
        validate: (value) => value === '' || validateSourcePrefix(value, known, releasePrefix)
      }
    ]);
    if (newPrefix) {
      known.push(newPrefix);
      selected.push(newPrefix);
    }
  }

  const keyByPrefix = new Map(
    Object.entries(current).filter(([type]) => type !== 'release').map(([type, prefix]) => [prefix, type])
  );
  const branchPrefix = {};
  for (const prefix of selected) {
    let key = keyByPrefix.get(prefix) || prefixKey(prefix);
    for (let n = 2; key in branchPrefix || key === 'release'; n++) {
      key = `${prefixKey(prefix)}${n}`;
    }
    branchPrefix[key] = prefix;
  }
  return branchPrefix;
}

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
          type: 'password',
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

  // Start from the existing config (merged with defaults) without validating it, so the wizard
  // can also be used to repair an invalid file.
  let config;
  try {
    config = loadConfig({ validate: false }) || getDefaultConfig();
  } catch (error) {
    logger.warn(`${error.message}\nStarting from the default configuration instead.`);
    config = getDefaultConfig();
  }
  if (!config.release || !Array.isArray(config.release.branches)) {
    config.release = { ...(config.release || {}), branches: [] };
  }
  if (!config.ai || typeof config.ai !== 'object') {
    config.ai = getDefaultConfig().ai;
  }

  const { stagingBranch } = await inquirer.prompt([
    {
      type: 'input',
      name: 'stagingBranch',
      message: 'Staging branch name:',
      default: config.git.stagingBranch
    }
  ]);

  const sourcePrefixes = await promptSourcePrefixes(config);
  const sourcePrefixList = Object.values(sourcePrefixes);

  const questions = [
    {
      type: 'input',
      name: 'releasePrefix',
      message: 'Release branch prefix:',
      default: config.git.branchPrefix.release || getDefaultConfig().git.branchPrefix.release,
      filter: normalizePrefix,
      validate: (value) => {
        if (!value) return 'The release prefix is required';
        if (sourcePrefixList.includes(value)) return `${value} is already a source branch prefix`;
        return true;
      }
    },
    {
      type: 'list',
      name: 'branchSource',
      message: `Where should source branches (${sourcePrefixList.join(', ')}) be looked up?`,
      choices: [
        { name: 'Local branches first, origin as a fallback', value: 'local' },
        { name: 'Origin only', value: 'remote' }
      ],
      default: config.git.branchSource || 'local'
    },
    {
      type: 'input',
      name: 'gitlabHost',
      message: 'GitLab hostname, e.g. gitlab.example.com (leave blank to use the host of the origin remote):',
      default: config.gitlab.host,
      // Keeps only the host if a project/page URL is pasted (see normalizeGitlabHost)
      filter: (value) => gitlab.normalizeGitlabHost(value)
    },
    {
      type: 'password',
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

  let aiSelection = null;
  if (answers.aiEnabled) {
    aiSelection = await promptAiProviderAndModel(config);
  }

  const newConfig = {
    git: {
      stagingBranch,
      branchSource: answers.branchSource,
      branchPrefix: {
        ...sourcePrefixes,
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
      ...config.release,
      autoCreateMR: answers.autoCreateMR
    }
  };

  if (answers.autoCreateMR) {
    newConfig.release.mrTitleFormat = answers.mrTitleFormat;
    newConfig.release.mrSquash = answers.mrSquash;
    newConfig.release.mrRemoveSourceBranch = answers.mrRemoveSourceBranch;

    await selectDefaultMembers(newConfig);
    await selectDefaultLabels(newConfig);
  }

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
    return config;
  }

  try {
    validateConfig(newConfig);
    saveConfig(newConfig);
    logger.success(`Configuration saved to ${getConfigPath()}`);
    return newConfig;
  } catch (error) {
    logger.error(error.message);
    return null;
  }
}

// Sets release.defaultReviewers / release.defaultAssignees, picking from the real GitLab project
// members (REST API, with the token just configured) when possible, or typed usernames otherwise.
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
  // Not gitlab.ensureAuthenticated(): it prompts for a token and saves the config to disk, which
  // would bypass the wizard's review/cancel step. Without a token, fall back to typed usernames.
  if (!gitlab.getToken(config)) {
    logger.warn('No GitLab token configured (gitlab.token / GITLAB_TOKEN), so project members can\'t be listed; enter usernames manually instead.');
    return null;
  }

  try {
    logger.info('Loading GitLab project members...');
    const members = await gitlab.getProjectMembers(config);
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

// Sets release.defaultLabels (added to every MR), picked from the project's real labels when they
// can be listed, or typed otherwise. Like the members, it never prompts for a token mid-wizard.
async function selectDefaultLabels(config) {
  const release = config.release;
  const current = Array.isArray(release.defaultLabels) ? release.defaultLabels : [];
  const labels = await fetchProjectLabels(config);

  if (!labels) {
    const { defaultLabels } = await inquirer.prompt([
      { type: 'input', name: 'defaultLabels', message: 'Default MR labels (comma-separated, blank for none):', default: current.join(', ') }
    ]);
    release.defaultLabels = String(defaultLabels).split(',').map(l => l.trim()).filter(Boolean);
    return;
  }

  const isCurrent = (name) => current.some(c => c.toLowerCase() === name.toLowerCase());
  const choices = labels.map(label => ({
    name: label.description ? `${label.name} — ${truncate(label.description, 60)}` : label.name,
    value: label.name,
    checked: isCurrent(label.name)
  }));
  // Keep configured labels that no longer exist in the project visible, so they aren't dropped
  // silently — the user decides whether to keep them.
  for (const name of current) {
    if (!labels.some(label => label.name.toLowerCase() === name.toLowerCase())) {
      choices.push({ name: `${name} (not found among project labels)`, value: name, checked: true });
    }
  }

  const { defaultLabels } = await inquirer.prompt([
    searchableCheckbox({
      name: 'defaultLabels',
      message: 'Default MR labels, added to every MR (space to toggle, type to search):',
      pageSize: 15,
      default: choices.filter(c => c.checked).map(c => c.value)
    }, choices)
  ]);
  release.defaultLabels = defaultLabels;
}

async function fetchProjectLabels(config) {
  if (!gitlab.getToken(config)) {
    logger.warn('No GitLab token configured (gitlab.token / GITLAB_TOKEN), so project labels can\'t be listed; enter them manually instead.');
    return null;
  }

  try {
    logger.info('Loading GitLab project labels...');
    const labels = await gitlab.getProjectLabels(config);
    if (labels.length === 0) {
      logger.warn('The GitLab project has no labels to choose from; enter them manually instead.');
      return null;
    }
    return labels;
  } catch (error) {
    logger.warn(`Could not load GitLab project labels (${error.message}); enter them manually instead.`);
    return null;
  }
}

function truncate(text, max) {
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
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

module.exports = {
  setupWizard,
  ensureAiSettings,
  promptAiProviderAndModel,
  promptSourcePrefixes
};
