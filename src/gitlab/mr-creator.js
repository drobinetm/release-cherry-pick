'use strict';

const GitLabClient = require('./client');
const logger = require('../utils/logger');
const { GitLabError } = require('../utils/errors');

async function createMR(config, sourceBranch, taskId, description, commits = []) {
  const client = new GitLabClient(config.gitlab.url, config.gitlab.token, config.gitlab.projectId);

  try {
    // Validate connection first
    await client.validateConnection();

    // Format title with task ID
    const title = `[${taskId}] ${description}`;

    // Generate description from commits if not provided
    let mrDescription = description;
    if (commits.length > 0) {
      mrDescription = generateDescriptionFromCommits(taskId, description, commits);
    }

    // Create the MR
    const result = await client.createMergeRequest(
      sourceBranch,
      config.git.stagingBranch,
      title,
      mrDescription
    );

    return result;
  } catch (error) {
    throw new GitLabError(`Failed to create MR for ${taskId}: ${error.message}`);
  }
}

function generateDescriptionFromCommits(taskId, description, commits) {
  let mrDescription = `## ${taskId}: ${description}\n\n`;
  mrDescription += `### Commits included:\n\n`;

  for (const commit of commits) {
    mrDescription += `- ${commit.hash}: ${commit.message}\n`;
  }

  return mrDescription;
}

module.exports = {
  createMR,
  generateDescriptionFromCommits
};
