'use strict';

const defaultConfig = {
  git: {
    stagingBranch: 'staging',
    branchPrefix: {
      feature: 'feature/',
      hotfix: 'hotfix/',
      release: 'release/'
    }
  },
  gitlab: {
    host: ''
  },
  ai: {
    enabled: false,
    provider: 'anthropic',
    apiKey: '',
    model: 'claude-haiku-4-5-20251001'
  },
  release: {
    autoCreateMR: true,
    mrTitleFormat: '[{taskId}] {description}',
    // GitLab usernames, picked from the real project members in the setup wizard
    defaultReviewers: [],
    defaultAssignees: [],
    mrSquash: true,
    mrRemoveSourceBranch: true
    // Legacy: release.defaultReviewerPattern (a regex over member usernames) is still honored
    // when present in an existing config file and defaultReviewers is empty.
  }
};

function getDefaultConfig() {
  return JSON.parse(JSON.stringify(defaultConfig));
}

module.exports = {
  getDefaultConfig,
  defaultConfig
};
