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

  if (errors.length > 0) {
    throw new ConfigError(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return true;
}

module.exports = {
  validateConfig,
  validateConfigPartial
};
