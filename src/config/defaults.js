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
    host: '',
    token: ''
  },
  ai: {
    enabled: true,
    provider: 'anthropic',
    apiKey: '',
    model: 'claude-haiku-4-5-20251001',
    baseURL: 'https://api.anthropic.com/v1'
  },
  release: {
    autoCreateMR: true,
    mrTitleFormat: '[{taskId}] {description}',
    // GitLab usernames, picked from the real project members in the setup wizard
    defaultReviewers: [],
    defaultAssignees: [],
    mrSquash: true,
    mrRemoveSourceBranch: true,
    branches: []
  }
};

function getDefaultConfig() {
  return JSON.parse(JSON.stringify(defaultConfig));
}

module.exports = {
  getDefaultConfig,
  defaultConfig
};
