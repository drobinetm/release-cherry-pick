'use strict';

const logger = require('../utils/logger');

const DEFAULT_PROVIDER = 'anthropic';
const MODELS_DEV_URL = 'https://models.dev/api.json';
const CATALOG_TIMEOUT_MS = 8000;
const LIVE_TIMEOUT_MS = 10000;

// Used when models.dev is unreachable, or when a popular provider has no `api` field in the catalog.
const KNOWN_BASE_URLS = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  google: null,
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  togetherai: 'https://api.together.xyz/v1',
  fireworksai: 'https://api.fireworks.ai/inference/v1',
  perplexity: 'https://api.perplexity.ai',
  deepseek: 'https://api.deepseek.com',
  openrouter: 'https://openrouter.ai/api/v1',
  'github-copilot': 'https://api.githubcopilot.com',
  lmstudio: 'http://127.0.0.1:1234/v1',
  alibaba: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  moonshotai: 'https://api.moonshot.ai/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1'
};

// Minimal offline fallback so the wizard still works without network access.
const FALLBACK_CATALOG = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    env: 'ANTHROPIC_API_KEY',
    api: KNOWN_BASE_URLS.anthropic,
    models: {
      'claude-haiku-4-5': { id: 'claude-haiku-4-5', tool_call: true },
      'claude-sonnet-4-5': { id: 'claude-sonnet-4-5', tool_call: true },
      'claude-opus-4-5': { id: 'claude-opus-4-5', tool_call: true }
    }
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    env: 'OPENAI_API_KEY',
    api: KNOWN_BASE_URLS.openai,
    models: {
      'gpt-4o-mini': { id: 'gpt-4o-mini', tool_call: true },
      'gpt-4o': { id: 'gpt-4o', tool_call: true },
      'gpt-4.1-mini': { id: 'gpt-4.1-mini', tool_call: true },
      'gpt-4.1': { id: 'gpt-4.1', tool_call: true }
    }
  },
  google: {
    id: 'google',
    name: 'Google',
    env: 'GOOGLE_API_KEY,GEMINI_API_KEY',
    api: null,
    models: {
      'gemini-2.5-flash': { id: 'gemini-2.5-flash', tool_call: true },
      'gemini-2.5-pro': { id: 'gemini-2.5-pro', tool_call: true }
    }
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    env: 'GROQ_API_KEY',
    api: KNOWN_BASE_URLS.groq,
    models: {
      'llama-3.3-70b-versatile': { id: 'llama-3.3-70b-versatile', tool_call: true }
    }
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    env: 'DEEPSEEK_API_KEY',
    api: KNOWN_BASE_URLS.deepseek,
    models: {
      'deepseek-chat': { id: 'deepseek-chat', tool_call: true },
      'deepseek-reasoner': { id: 'deepseek-reasoner', tool_call: true }
    }
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    env: 'OPENROUTER_API_KEY',
    api: KNOWN_BASE_URLS.openrouter,
    models: {
      'openai/gpt-4o-mini': { id: 'openai/gpt-4o-mini', tool_call: true },
      'anthropic/claude-sonnet-4.5': { id: 'anthropic/claude-sonnet-4.5', tool_call: true }
    }
  }
};

let catalogCache = null;
let catalogCacheAt = 0;

function normalizeEnvKeys(env) {
  if (!env) return [];
  if (Array.isArray(env)) return env.filter(Boolean);
  return String(env).split(',').map((key) => key.trim()).filter(Boolean);
}

function getEnvKeyNames(provider) {
  if (!provider) return [];
  return normalizeEnvKeys(provider.env);
}

function findEnvValue(envKeyNames) {
  for (const key of envKeyNames) {
    if (process.env[key]) return process.env[key];
  }
  return '';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = CATALOG_TIMEOUT_MS) {
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await globalThis.fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Loads the full provider catalog (200+ providers) from models.dev — same source OpenCode uses.
async function loadProviderCatalog({ force = false } = {}) {
  const now = Date.now();
  if (!force && catalogCache && now - catalogCacheAt < 5 * 60 * 1000) {
    return catalogCache;
  }

  try {
    const response = await fetchWithTimeout(MODELS_DEV_URL);
    if (!response.ok) {
      throw new Error(`models.dev HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      throw new Error('models.dev returned an empty catalog');
    }
    catalogCache = data;
    catalogCacheAt = Date.now();
    return data;
  } catch (error) {
    logger.warn(`Could not load provider catalog from models.dev (${error.message}); using built-in fallback list`);
    catalogCache = FALLBACK_CATALOG;
    catalogCacheAt = Date.now();
    return catalogCache;
  }
}

function isChatModel(model) {
  if (!model) return false;
  if (model.tool_call) return true;
  const output = model.modalities && model.modalities.output;
  return Array.isArray(output) && output.includes('text');
}

function catalogModelIds(provider) {
  if (!provider || !provider.models) return [];
  return Object.keys(provider.models)
    .filter((id) => isChatModel(provider.models[id]))
    .sort((a, b) => a.localeCompare(b));
}

function getProviderChoices(catalog) {
  return Object.values(catalog)
    .map((provider) => ({
      name: provider.name || provider.id,
      value: provider.id
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveApiKey(config, providerId, providerEntry) {
  if (config && config.ai && config.ai.apiKey) {
    return config.ai.apiKey;
  }
  const envValue = findEnvValue(getEnvKeyNames(providerEntry));
  if (envValue) return envValue;
  // Legacy single-key configs from earlier releases
  const legacyEnv = providerId === 'anthropic' ? 'ANTHROPIC_API_KEY'
    : providerId === 'openai' ? 'OPENAI_API_KEY' : '';
  return legacyEnv && process.env[legacyEnv] ? process.env[legacyEnv] : '';
}

function resolveBaseURL(providerId, providerEntry, config) {
  if (config && config.ai && config.ai.baseURL) return config.ai.baseURL;
  if (providerEntry && providerEntry.api) return providerEntry.api;
  return KNOWN_BASE_URLS[providerId] || null;
}

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}${path}`;
}

async function listModelsLive(providerId, provider, apiKey, baseURL) {
  if (!apiKey) return null;

  try {
    if (providerId === 'anthropic') {
      const response = await fetchWithTimeout(joinUrl(baseURL || KNOWN_BASE_URLS.anthropic, '/models?limit=1000'), {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }
      }, LIVE_TIMEOUT_MS);
      if (!response.ok) return null;
      const data = await response.json();
      const models = (data.data || []).map((m) => m.id).filter(Boolean);
      return models.length ? models.sort((a, b) => a.localeCompare(b)) : null;
    }

    if (providerId === 'google') {
      const response = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`,
        {},
        LIVE_TIMEOUT_MS
      );
      if (!response.ok) return null;
      const data = await response.json();
      const models = (data.models || [])
        .map((m) => (m.name || '').replace(/^models\//, ''))
        .filter(Boolean);
      return models.length ? models.sort((a, b) => a.localeCompare(b)) : null;
    }

    if (baseURL) {
      const response = await fetchWithTimeout(joinUrl(baseURL, '/models'), {
        headers: { Authorization: `Bearer ${apiKey}` }
      }, LIVE_TIMEOUT_MS);
      if (!response.ok) return null;
      const data = await response.json();
      const raw = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
      const models = raw
        .map((m) => m.id || m.name || (typeof m === 'string' ? m : null))
        .filter(Boolean);
      return models.length ? models.sort((a, b) => a.localeCompare(b)) : null;
    }
  } catch (error) {
    logger.warn(`Live model list from provider failed: ${error.message}`);
  }

  return null;
}

// Connects to the provider and lists its models; falls back to the models.dev catalog.
async function listModelsForProvider(providerId, provider, apiKey, baseURL) {
  const live = await listModelsLive(providerId, provider, apiKey, baseURL);
  if (live && live.length > 0) {
    return { models: live, source: 'live' };
  }

  const fromCatalog = catalogModelIds(provider);
  if (fromCatalog.length > 0) {
    return { models: fromCatalog, source: 'catalog' };
  }

  if (provider && provider.models) {
    const all = Object.keys(provider.models).sort((a, b) => a.localeCompare(b));
    if (all.length > 0) {
      return { models: all, source: 'catalog' };
    }
  }

  return { models: [], source: 'none' };
}

module.exports = {
  DEFAULT_PROVIDER,
  KNOWN_BASE_URLS,
  FALLBACK_CATALOG,
  loadProviderCatalog,
  getProviderChoices,
  getEnvKeyNames,
  findEnvValue,
  catalogModelIds,
  resolveApiKey,
  resolveBaseURL,
  listModelsForProvider,
  normalizeEnvKeys
};
