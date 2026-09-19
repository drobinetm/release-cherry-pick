'use strict';

const { ConfigError } = require('../utils/errors');

function validateConfig(config) {
  const errors = [];

  if (!config.git) {
    errors.push('Missing git configuration');
  } else {
    if (!config.git.stagingBranch) {
      errors.push('Missing git.stagingBranch');
    }
    if (!config.git.branchPrefix) {
      errors.push('Missing git.branchPrefix');
    }
  }

  if (!config.gitlab) {
    errors.push('Missing gitlab configuration');
  } else {
    if (!config.gitlab.url) {
      errors.push('Missing gitlab.url');
    }
    if (!config.gitlab.token) {
      errors.push('Missing gitlab.token');
    }
  }

  if (errors.length > 0) {
    throw new ConfigError(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return true;
}

function validateConfigPartial(config) {
  const errors = [];

  if (config.git) {
    if (config.git.stagingBranch && typeof config.git.stagingBranch !== 'string') {
      errors.push('git.stagingBranch must be a string');
    }
  }

  if (config.gitlab) {
    if (config.gitlab.url && !isValidUrl(config.gitlab.url)) {
      errors.push('gitlab.url must be a valid URL');
    }
  }

  if (errors.length > 0) {
    throw new ConfigError(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return true;
}

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  validateConfig,
  validateConfigPartial
};
