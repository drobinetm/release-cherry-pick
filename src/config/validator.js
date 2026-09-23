'use strict';

const { ConfigError } = require('../utils/errors');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Validates a complete (already merged with defaults) config. Collects every problem and throws a
// single ConfigError listing them all, so a broken file is reported up front with a clear message.
function validateConfig(config, source = 'configuration') {
  const errors = [];

  const expect = (value, name, check, description) => {
    if (!check(value)) {
      errors.push(`${name} must be ${description} (got ${JSON.stringify(value)})`);
    }
  };
  const isString = v => typeof v === 'string';
  const isNonEmptyString = v => typeof v === 'string' && v.trim() !== '';
  const isBoolean = v => typeof v === 'boolean';
  const isStringArray = v => Array.isArray(v) && v.every(isNonEmptyString);

  for (const section of ['git', 'gitlab', 'ai', 'release']) {
    if (!isPlainObject(config[section])) {
      errors.push(`${section} must be an object`);
    }
  }

  if (errors.length === 0) {
    const { git, gitlab, ai, release } = config;

    expect(git.stagingBranch, 'git.stagingBranch', isNonEmptyString, 'a non-empty string');
    if (isPlainObject(git.branchPrefix)) {
      for (const [type, prefix] of Object.entries(git.branchPrefix)) {
        expect(prefix, `git.branchPrefix.${type}`, isString, 'a string');
      }
      expect(git.branchPrefix.release, 'git.branchPrefix.release', isNonEmptyString, 'a non-empty string');
    } else {
      errors.push('git.branchPrefix must be an object');
    }

    expect(gitlab.host, 'gitlab.host', isString, 'a string');

    expect(ai.enabled, 'ai.enabled', isBoolean, 'true or false');
    expect(ai.apiKey, 'ai.apiKey', isString, 'a string');
    expect(ai.model, 'ai.model', isNonEmptyString, 'a non-empty string');

    expect(release.autoCreateMR, 'release.autoCreateMR', isBoolean, 'true or false');
    expect(release.mrTitleFormat, 'release.mrTitleFormat', isNonEmptyString, 'a non-empty string');
    expect(release.mrSquash, 'release.mrSquash', isBoolean, 'true or false');
    expect(release.mrRemoveSourceBranch, 'release.mrRemoveSourceBranch', isBoolean, 'true or false');
    expect(release.defaultReviewers, 'release.defaultReviewers', isStringArray, 'a list of GitLab usernames');
    expect(release.defaultAssignees, 'release.defaultAssignees', isStringArray, 'a list of GitLab usernames');

    if (release.defaultReviewerPattern !== undefined) {
      try {
        new RegExp(release.defaultReviewerPattern, 'i');
      } catch (error) {
        errors.push(`release.defaultReviewerPattern is not a valid regular expression: ${error.message}`);
      }
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
    throw new ConfigError(`Invalid ${source}:\n  - ${errors.join('\n  - ')}`);
  }

  return true;
}

module.exports = {
  validateConfig
};
