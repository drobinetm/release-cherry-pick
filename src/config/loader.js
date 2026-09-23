'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { ConfigError } = require('../utils/errors');
const { parseRemoteUrl } = require('../git/remote-url');
const { getDefaultConfig } = require('./defaults');
const { validateConfig } = require('./validator');

// The config can hold secrets (gitlab.token, ai.apiKey), so it lives in the developer's home
// directory, never inside the project, where it could end up committed. One file per project.
// RELEASE_CHERRY_PICK_CONFIG_DIR overrides the directory (used by the sandbox and tests).
function getConfigDir() {
  return process.env.RELEASE_CHERRY_PICK_CONFIG_DIR || path.join(os.homedir(), '.release-cherry-pick');
}

function runGit(args) {
  try {
    return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function toFileName(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^[_.]+|_+$/g, '');
}

// Identifies the current project: from the origin remote (host + project path, e.g.
// "gitlab.example.com_group_proj"), so it's unique even when two checkouts share a folder name and
// stable if the folder is moved or renamed; without a usable remote, from the repository folder name
// plus a short hash of its absolute path.
function getProjectKey() {
  const remote = parseRemoteUrl(runGit(['remote', 'get-url', 'origin']));
  if (remote && remote.host && remote.projectPath) {
    return toFileName(`${remote.host}_${remote.projectPath}`);
  }

  const root = path.resolve(runGit(['rev-parse', '--show-toplevel']) || process.cwd());
  const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  const hash = crypto.createHash('sha1').update(normalizedRoot).digest('hex').slice(0, 8);
  return `${toFileName(path.basename(root)) || 'project'}-${hash}`;
}

// Resolved once per run (per working directory): the project doesn't change during a release.
const configPathCache = new Map();
function getConfigPath() {
  const cwd = process.cwd();
  if (!configPathCache.has(cwd)) {
    configPathCache.set(cwd, path.join(getConfigDir(), `${getProjectKey()}.json`));
  }
  return configPathCache.get(cwd);
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
    // Owner-only permissions (applied on Linux/macOS; on Windows the home folder is already private)
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (error) {
    throw new ConfigError(`Error saving config file ${configPath}: ${error.message}`);
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
  getConfigDir,
  mergeWithDefaults
};
