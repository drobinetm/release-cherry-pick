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
    defaultAssignees: [],
    mrSquash: true,
    mrRemoveSourceBranch: true,
    defaultReviewerPattern: '^che(i|y)ner$',
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
