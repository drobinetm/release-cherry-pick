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

  if (config.release && config.release.branches !== undefined && !Array.isArray(config.release.branches)) {
    errors.push('release.branches must be an array');
  }

  if (config.gitlab && config.gitlab.host !== undefined && typeof config.gitlab.host !== 'string') {
    errors.push('gitlab.host must be a string');
  }

  if (config.gitlab && config.gitlab.token !== undefined && typeof config.gitlab.token !== 'string') {
    errors.push('gitlab.token must be a string');
  }

  if (config.ai && config.ai.provider !== undefined && typeof config.ai.provider !== 'string') {
    errors.push('ai.provider must be a string');
  }

  if (config.ai && config.ai.model !== undefined && typeof config.ai.model !== 'string') {
    errors.push('ai.model must be a string');
  }

  if (config.ai && config.ai.baseURL !== undefined && typeof config.ai.baseURL !== 'string') {
    errors.push('ai.baseURL must be a string');
  }

  if (errors.length > 0) {
    throw new ConfigError(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return true;
}

module.exports = {
  validateConfig,
  validateConfigPartial
};
