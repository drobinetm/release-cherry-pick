'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

async function generateAIDescription(config, taskId, description, commits) {
  if (!config.ai.enabled || !config.ai.apiKey) {
    return null;
  }

  try {
    const commitMessages = commits.map(c => c.message).join('\n');

    const prompt = `Generate a professional merge request description in Spanish for:
Task ID: ${taskId}
Description: ${description}
Commits:
${commitMessages}

Format the description with:
1. A brief summary
2. Changes made
3. Testing considerations`;

    // This is a placeholder for AI integration
    // In production, you would integrate with OpenAI, Claude, or similar
    logger.info('AI description generation not yet implemented');

    return null;
  } catch (error) {
    logger.warn(`AI description generation failed: ${error.message}`);
    return null;
  }
}

module.exports = {
  generateAIDescription
};
