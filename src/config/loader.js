'use strict';

const fs = require('fs');
const path = require('path');
const { ConfigError } = require('../utils/errors');
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
    return true;
  } catch (error) {
    throw new ConfigError(`Error saving config file: ${error.message}`);
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
  mergeWithDefaults
};
