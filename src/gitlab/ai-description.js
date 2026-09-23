'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');
const {
  DEFAULT_PROVIDER,
  loadProviderCatalog,
  resolveApiKey,
  resolveBaseURL
} = require('../config/ai-providers');

function buildPrompt(taskId, description, commitLines) {
  return `You are generating a GitLab merge request title and description for a release cherry-pick.
Task ID: ${taskId}
Task description: ${description}
Commits included:
${commitLines}

Write:
1. A concise MR title, max ~72 chars, starting with "[${taskId}] " followed by a short summary.
2. A clear Markdown MR description summarizing the change and referencing ${taskId}.

Return ONLY JSON, no markdown fences, matching exactly: {"title": "...", "description": "..."}`;
}

async function generateWithAnthropic({ apiKey, model, prompt, baseURL }) {
  const client = new Anthropic({ apiKey, baseURL: baseURL || undefined });
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('Anthropic response contained no text block');
  }
  return textBlock.text.trim();
}

async function generateWithGoogle({ apiKey, model, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1024 }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const parts = data.candidates && data.candidates[0] && data.candidates[0].content
    ? data.candidates[0].content.parts || []
    : [];
  const text = parts.map((part) => part.text || '').join('').trim();
  if (!text) {
    throw new Error('Google response contained no content');
  }
  return text;
}

async function generateWithOpenAICompatible({ apiKey, model, prompt, baseURL }) {
  if (!baseURL) {
    throw new Error('No API base URL configured for this provider');
  }
  const url = `${String(baseURL).replace(/\/+$/, '')}/chat/completions`;
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Provider API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : null;
  if (!content) {
    throw new Error('Provider response contained no content');
  }
  return content.trim();
}

async function generateMRTitleAndDescription(config, taskId, description, commits = []) {
  if (!config.ai || !config.ai.enabled) {
    return null;
  }

  const providerId = String(config.ai.provider || DEFAULT_PROVIDER).toLowerCase();

  const catalog = await loadProviderCatalog().catch(() => ({}));
  const providerEntry = catalog[providerId];

  const apiKey = resolveApiKey(config, providerId, providerEntry);
  if (!apiKey) {
    const envHint = providerEntry ? ` or its env var` : '';
    logger.warn(`AI enabled but no API key for ${providerId} (config.ai.apiKey${envHint}); using template MR content`);
    return null;
  }

  const baseURL = resolveBaseURL(providerId, providerEntry, config);
  const model = config.ai.model;
  if (!model) {
    logger.warn('AI enabled but no model saved in configuration; using template MR content');
    return null;
  }

  const commitLines = commits.map((c) => `- ${c.hash}: ${c.message}`).join('\n') || '(no commit messages available)';
  const prompt = buildPrompt(taskId, description, commitLines);

  try {
    let rawText;
    if (providerId === 'anthropic' || (baseURL && baseURL.includes('api.anthropic.com'))) {
      rawText = await generateWithAnthropic({ apiKey, model, prompt, baseURL });
    } else if (providerId === 'google') {
      rawText = await generateWithGoogle({ apiKey, model, prompt });
    } else {
      rawText = await generateWithOpenAICompatible({ apiKey, model, prompt, baseURL });
    }

    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);
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
