'use strict';

const logger = require('../utils/logger');
const { GitLabError } = require('../utils/errors');
const glab = require('../glab/client');
const { generateMRTitleAndDescription } = require('./ai-description');

function buildFallbackTitle(config, taskId, description) {
  const format = (config.release && config.release.mrTitleFormat) || '[{taskId}] {description}';
  return format.replace('{taskId}', taskId).replace('{description}', description);
}

function buildFallbackDescription(taskId, description, commits) {
  let mrDescription = `## ${taskId}: ${description}\n\n### Commits included:\n\n`;
  for (const commit of commits) {
    mrDescription += `- ${commit.hash}: ${commit.message}\n`;
  }
  return mrDescription;
}

async function createMR(config, { sourceBranch, targetBranch, taskId, description, commits = [], reviewers = [] }) {
  let title = buildFallbackTitle(config, taskId, description);
  let mrDescription = buildFallbackDescription(taskId, description, commits);

  const aiResult = await generateMRTitleAndDescription(config, taskId, description, commits);
  if (aiResult) {
    title = aiResult.title;
    mrDescription = aiResult.description;
  }

  try {
    const result = await glab.createMergeRequest({
      sourceBranch,
      targetBranch,
      title,
      description: mrDescription,
      reviewers,
      squash: config.release.mrSquash !== false,
      removeSourceBranch: config.release.mrRemoveSourceBranch !== false
    });

    logger.success(`MR created: ${result.url}`);
    return result;
  } catch (error) {
    throw new GitLabError(`Failed to create MR for ${taskId}: ${error.message}`);
  }
}

module.exports = {
  createMR,
  buildFallbackTitle,
  buildFallbackDescription
};
