'use strict';

// Parses a git remote URL into { host, protocol, projectPath }. Handles SCP-like SSH remotes
// (git@host:group/proj.git) and scheme URLs (https://[user@]host[:port]/group/proj.git,
// ssh://git@host:2222/group/proj.git). Only http(s) keeps the port in `host`: an SSH port isn't
// where the web API lives. Returns null if the URL can't be parsed.
function parseRemoteUrl(url) {
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
  if (!hasScheme) {
    // SCP-like syntax: "[user@]host:path" (checking for a scheme first matters: "https://..."
    // contains ":" too, which used to be misread as SCP syntax)
    const scp = url.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
    return scp ? { host: scp[1], protocol: 'https', projectPath: normalizeProjectPath(scp[2]) } : null;
  }

  try {
    const parsed = new URL(url);
    const isHttp = /^https?:$/.test(parsed.protocol);
    return {
      host: isHttp ? parsed.host : parsed.hostname,
      // Web/API protocol: an http:// remote means GitLab is served over plain http
      protocol: isHttp ? parsed.protocol.slice(0, -1) : 'https',
      projectPath: normalizeProjectPath(parsed.pathname)
    };
  } catch {
    return null;
  }
}

function normalizeProjectPath(projectPath) {
  return decodeURIComponent(projectPath).replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
}

module.exports = { parseRemoteUrl };
