'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

function buildClient(config) {
  const apiKey = (config.ai && config.ai.apiKey) || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new Anthropic({ apiKey });
}

async function generateMRTitleAndDescription(config, taskId, description, commits = []) {
  if (!config.ai || !config.ai.enabled) {
    return null;
  }

  const client = buildClient(config);
  if (!client) {
    logger.warn('AI enabled but no Anthropic API key found (config.ai.apiKey or ANTHROPIC_API_KEY); using template MR content');
    return null;
  }

  const commitLines = commits.map((c) => `- ${c.hash}: ${c.message}`).join('\n') || '(no commit messages available)';
  const prompt = `You are generating a GitLab merge request title and description for a release cherry-pick.
Task ID: ${taskId}
Task description: ${description}
Commits included:
${commitLines}

Write:
1. A concise MR title, max ~72 chars, starting with "[${taskId}] " followed by a short summary.
2. A clear Markdown MR description summarizing the change and referencing ${taskId}.

Return ONLY JSON, no markdown fences, matching exactly: {"title": "...", "description": "..."}`;

  try {
    const response = await client.messages.create({
      model: (config.ai && config.ai.model) || DEFAULT_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) {
      return null;
    }

    const parsed = JSON.parse(textBlock.text.trim());
    if (!parsed.title || !parsed.description) {
      return null;
    }

    return { title: parsed.title, description: parsed.description };
  } catch (error) {
    logger.warn(`AI MR content generation failed, falling back to template: ${error.message}`);
    return null;
  }
}

module.exports = { generateMRTitleAndDescription };
