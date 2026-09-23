'use strict';

// Masks a secret for display, keeping only enough to recognize it: a known token prefix
// ("glpat-" for GitLab personal access tokens) and the last 4 characters.
// e.g. "glpat-AbCdEf123456WxYz" -> "glpat-****WxYz". Empty values stay empty.
function maskSecret(value) {
  if (!value) {
    return '';
  }

  const secret = String(value);
  const prefix = secret.startsWith('glpat-') ? 'glpat-' : '';
  const rest = secret.slice(prefix.length);
  // Too short to reveal any characters without giving away most of it
  if (rest.length <= 8) {
    return `${prefix}****`;
  }
  return `${prefix}****${rest.slice(-4)}`;
}

module.exports = { maskSecret };
