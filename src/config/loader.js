'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ConfigError } = require('../utils/errors');
const logger = require('../utils/logger');
const { getDefaultConfig } = require('./defaults');
const { validateConfig } = require('./validator');

const CONFIG_FILE = '.release-cherry-pick.json';

function getConfigPath() {
  return path.join(process.cwd(), CONFIG_FILE);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Recursively fills in whatever `config` is missing from `defaults`. Values present in `config`
// win (arrays are replaced, not merged); keys unknown to the defaults are kept as-is.
function mergeWithDefaults(defaults, config) {
  if (!isPlainObject(defaults) || !isPlainObject(config)) {
    return config === undefined ? defaults : config;
  }

  const merged = { ...defaults };
  for (const [key, value] of Object.entries(config)) {
    merged[key] = key in defaults ? mergeWithDefaults(defaults[key], value) : value;
  }
  return merged;
}

// Returns the config file merged over the defaults (so options added in newer versions are always
// present), or null if there's no config file. Validates the result unless `validate` is false.
function loadConfig({ validate = true } = {}) {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return null;
  }

  let fileConfig;
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new ConfigError(`Error reading config file ${configPath}: ${error.message}`);
  }

  if (!isPlainObject(fileConfig)) {
    throw new ConfigError(`Config file ${configPath} must contain a JSON object`);
  }

  const config = mergeWithDefaults(getDefaultConfig(), fileConfig);
  if (validate) {
    validateConfig(config, configPath);
  }
  return config;
}

function saveConfig(config) {
  const configPath = getConfigPath();

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    throw new ConfigError(`Error saving config file: ${error.message}`);
  }

  ensureConfigGitignored();
  return true;
}

// The config file can hold secrets (gitlab.token, ai.apiKey) and per-developer settings, so it must
// never be committed: make sure the project's .gitignore (next to the config file) lists it,
// creating .gitignore if needed. Runs on every save, but only touches the file when the entry is
// missing. Never throws — failing here must not prevent saving the config.
function ensureConfigGitignored() {
  const dir = path.dirname(getConfigPath());
  const gitignorePath = path.join(dir, '.gitignore');

  try {
    const exists = fs.existsSync(gitignorePath);
    const content = exists ? fs.readFileSync(gitignorePath, 'utf8') : '';
    const alreadyListed = content
      .split(/\r?\n/)
      .map(line => line.trim())
      .some(line => line === CONFIG_FILE || line === `/${CONFIG_FILE}`);

    if (!alreadyListed) {
      const eol = content.includes('\r\n') ? '\r\n' : '\n';
      const separator = content === '' || content.endsWith('\n') ? '' : eol;
      const blankLine = content.trim() === '' ? '' : eol;
      const entry = `${separator}${blankLine}# release-cherry-pick local config (may contain API keys/tokens)${eol}${CONFIG_FILE}${eol}`;
      fs.appendFileSync(gitignorePath, entry, 'utf8');
      logger.info(exists
        ? `Added ${CONFIG_FILE} to .gitignore — remember to commit the .gitignore change`
        : `Created .gitignore with ${CONFIG_FILE} so it isn't committed`);
    }
  } catch (error) {
    logger.warn(`Could not add ${CONFIG_FILE} to .gitignore (${error.message}); add it manually so API keys aren't committed`);
    return;
  }

  // .gitignore doesn't affect files that are already tracked
  try {
    const tracked = execFileSync('git', ['ls-files', '--', CONFIG_FILE], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (tracked.trim()) {
      logger.warn(`${CONFIG_FILE} is already committed to git, so .gitignore won't stop it from being pushed. Untrack it with \`git rm --cached ${CONFIG_FILE}\` and commit (and rotate any key it contained).`);
    }
  } catch {
    // Not a git repository (or git unavailable): nothing is tracked, so nothing to warn about
  }
}

function configExists() {
  return fs.existsSync(getConfigPath());
}

module.exports = {
  loadConfig,
  saveConfig,
  configExists,
  getConfigPath,
  mergeWithDefaults,
  ensureConfigGitignored
};
