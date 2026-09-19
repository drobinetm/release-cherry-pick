'use strict';

const fs = require('fs');
const path = require('path');
const { ConfigError } = require('../utils/errors');

const CONFIG_FILE = '.release-cherry-pick.json';

function getConfigPath() {
  return path.join(process.cwd(), CONFIG_FILE);
}

function loadConfig() {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new ConfigError(`Error reading config file: ${error.message}`);
  }
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
  getConfigPath
};
