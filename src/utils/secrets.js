'use strict';

// Well-known secret prefixes kept visible when masking, longest first: GitLab personal access
// tokens, Anthropic API keys and OpenAI(-compatible) API keys.
const KNOWN_PREFIXES = ['glpat-', 'sk-ant-', 'sk-'];

// Masks a secret for display, keeping only enough to recognize it: a known prefix and the last
// 4 characters. e.g. "glpat-AbCdEf123456WxYz" -> "glpat-****WxYz". Empty values stay empty.
function maskSecret(value) {
  if (!value) {
    return '';
  }

  const secret = String(value);
  const prefix = KNOWN_PREFIXES.find(p => secret.startsWith(p)) || '';
  const rest = secret.slice(prefix.length);
  // Too short to reveal any characters without giving away most of it
  if (rest.length <= 8) {
    return `${prefix}****`;
  }
  return `${prefix}****${rest.slice(-4)}`;
}

module.exports = { maskSecret };
