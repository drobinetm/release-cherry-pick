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
    // Left empty on purpose: when AI is enabled and no provider/model is saved, ensureAiSettings
    // asks for them at release time. baseURL stays empty too, so each provider resolves its own
    // endpoint (resolveBaseURL prefers config.ai.baseURL, which would otherwise win for any provider).
    provider: '',
    apiKey: '',
    model: '',
    baseURL: ''
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
