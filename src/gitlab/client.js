'use strict';

const inquirer = require('inquirer');
const simpleGit = require('simple-git');
const logger = require('../utils/logger');
const { GitLabError } = require('../utils/errors');
const { saveConfig } = require('../config/loader');

const git = simpleGit();
const DEFAULT_HOST = 'gitlab.com';

function getToken(config) {
  return (config.gitlab && config.gitlab.token) || process.env.GITLAB_TOKEN || '';
}

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

// Reads and parses the `origin` remote (once per run; it doesn't change during a release).
let originRemotePromise = null;
function getOriginRemote() {
  if (!originRemotePromise) {
    originRemotePromise = (async () => {
      let url;
      try {
        url = (await git.raw(['remote', 'get-url', 'origin'])).trim();
      } catch (error) {
        throw new GitLabError(`Could not read git remote "origin": ${error.message}`);
      }
      const remote = parseRemoteUrl(url);
      if (!remote || !remote.projectPath) {
        throw new GitLabError(`Could not derive the GitLab project from the origin remote: ${url}`);
      }
      return { url, ...remote };
    })();
    originRemotePromise.catch(() => { originRemotePromise = null; });
  }
  return originRemotePromise;
}

// Turns whatever was configured as gitlab.host into the GitLab base URL ("https://host[:port]" plus
// a relative URL root if GitLab is installed under a sub-path, e.g. "https://example.com/gitlab").
// People often paste a project or page URL instead of the host, e.g.
// "https://gitlab.example.com/group/proj/-/project_members", which would put the API under the
// project path and 404; so everything from GitLab's "/-/" page separator on is dropped, and so is
// the origin remote's project path when the value ends with it.
async function normalizeGitlabHost(host) {
  let value = String(host || '').trim();
  if (!value) {
    return '';
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return value.replace(/\/+$/, '');
  }

  let pathname = url.pathname.replace(/\/-(\/.*)?$/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  try {
    const { projectPath } = await getOriginRemote();
    if (pathname.toLowerCase().endsWith(`/${projectPath}`.toLowerCase())) {
      pathname = pathname.slice(0, pathname.length - projectPath.length - 1);
    }
  } catch {
    // No usable origin remote: keep the path (it may be a relative URL root)
  }
  return `${url.protocol}//${url.host}${pathname}`;
}

let warnedAboutHost = false;

// API base URL: gitlab.host from config when set (needed e.g. when the SSH remote uses a
// ~/.ssh/config alias instead of the real host), otherwise the host of the origin remote, so a
// self-managed instance works without configuring anything; gitlab.com as a last resort.
async function getApiBase(config) {
  const configured = config.gitlab && config.gitlab.host;
  let base;
  if (configured) {
    base = await normalizeGitlabHost(configured);
    const asGiven = String(configured).trim().replace(/\/+$/, '');
    if (!warnedAboutHost && base !== asGiven && base !== `https://${asGiven}`) {
      warnedAboutHost = true;
      logger.warn(`gitlab.host "${configured}" looks like a project/page URL; using ${base} (run config --init to fix it, or leave it blank to use the origin remote's host)`);
    }
  } else {
    try {
      const remote = await getOriginRemote();
      base = `${remote.protocol}://${remote.host}`;
    } catch {
      base = `https://${DEFAULT_HOST}`;
    }
  }
  return `${base}/api/v4`;
}

// Project path (e.g. "group/sub/proj") from the `origin` remote, URL-encoded for use as `:id`.
// If gitlab.host includes a relative URL root (GitLab served under e.g. https://example.com/gitlab),
// the remote's path starts with it ("gitlab/group/proj"), and it isn't part of the project path.
async function getProjectPathId(config) {
  let { projectPath } = await getOriginRemote();
  const configured = config && config.gitlab && config.gitlab.host;
  if (configured) {
    try {
      const root = new URL(await normalizeGitlabHost(configured)).pathname.replace(/^\/+|\/+$/g, '');
      if (root && projectPath.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
        projectPath = projectPath.slice(root.length + 1);
      }
    } catch {
      // Unparseable host: keep the remote's path as-is
    }
  }
  return encodeURIComponent(projectPath);
}

async function apiRequest(config, path, { method = 'GET', body } = {}) {
  const token = getToken(config);
  if (!token) {
    throw new GitLabError(
      'No GitLab token. Set gitlab.token in config or the GITLAB_TOKEN environment variable (PAT with "api" scope).'
    );
  }

  const base = await getApiBase(config);
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    throw new GitLabError(`GitLab API request failed: ${error.message}`);
  }

  if (response.status === 401) {
    throw new GitLabError('GitLab authentication failed (401): token is invalid or expired');
  }
  if (response.status === 403) {
    const text = await response.text().catch(() => '');
    throw new GitLabError(`GitLab permission denied (403): ${text.slice(0, 300)}`);
  }
  if (response.status === 404) {
    // GitLab also answers 404 (not 403) for projects the token can't see
    throw new GitLabError(
      `GitLab resource not found (404) at ${base}${path.split('?')[0]}: check gitlab.host, the origin remote, and that the token's user can access the project`
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new GitLabError(`GitLab API error ${response.status}: ${text.slice(0, 300)}`);
  }

  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function checkAuthStatus(config) {
  try {
    const user = await apiRequest(config, '/user');
    return { authenticated: true, user };
  } catch (error) {
    return { authenticated: false, error };
  }
}

// Preflight: resolve a token (config → env → interactive PAT prompt), then validate via GET /user.
async function ensureAuthenticated(config) {
  let token = getToken(config);

  if (!token) {
    logger.warn('No GitLab token found (gitlab.token / GITLAB_TOKEN)');
    const { enteredToken } = await inquirer.prompt([
      {
        type: 'password',
        name: 'enteredToken',
        message: 'GitLab personal access token (scope "api"), leave blank to abort:',
        mask: '*',
        filter: (value) => (value ? String(value).trim() : '')
      }
    ]);

    if (!enteredToken) {
      throw new GitLabError(
        'GitLab authentication is required to create merge requests. Set gitlab.token or GITLAB_TOKEN, or disable release.autoCreateMR.'
      );
    }

    token = enteredToken;
    if (!config.gitlab || typeof config.gitlab !== 'object') {
      config.gitlab = {};
    }
    config.gitlab.token = token;
    saveConfig(config);
    logger.success('GitLab token saved to configuration');
  }

  const status = await checkAuthStatus(config);
  if (!status.authenticated) {
    throw new GitLabError(
      `GitLab authentication failed: ${status.error.message}. Check gitlab.host and that the token has "api" scope.`
    );
  }

  logger.success(`GitLab: authenticated as @${status.user.username}`);
  return true;
}

async function getProjectMembers(config) {
  try {
    const projectId = await getProjectPathId(config);
    const members = [];
    let page = 1;

    for (;;) {
      const batch = await apiRequest(
        config,
        `/projects/${projectId}/members/all?per_page=100&page=${page}`
      );
      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }
      members.push(...batch.map((m) => ({ id: m.id, username: m.username, name: m.name })));
      if (batch.length < 100) {
        break;
      }
      page += 1;
      if (page > 50) {
        break;
      }
    }

    return members;
  } catch (error) {
    if (error instanceof GitLabError) {
      throw new GitLabError(`Failed to list GitLab project members: ${error.message}`);
    }
    throw new GitLabError(`Failed to list GitLab project members: ${error.message}`);
  }
}

// Maps usernames to GitLab user IDs (the MR API takes IDs), warning about and skipping unknown ones.
function usernamesToIds(usernames, memberList, role) {
  const ids = [];
  const missing = [];
  for (const username of usernames) {
    const match = memberList.find((m) => m.username.toLowerCase() === username.toLowerCase());
    if (match) {
      ids.push(match.id);
    } else {
      missing.push(username);
    }
  }
  if (missing.length > 0) {
    logger.warn(`${role}(s) not found in project members (skipped): ${missing.join(', ')}`);
  }
  return ids;
}

async function createMergeRequest(
  config,
  { sourceBranch, targetBranch, title, description, reviewers = [], assignees = [], squash = true, removeSourceBranch = true, members = null }
) {
  try {
    const projectId = await getProjectPathId(config);

    let memberList = members;
    if (!memberList && (reviewers.length > 0 || assignees.length > 0)) {
      memberList = await getProjectMembers(config);
    }
    const reviewerIds = reviewers.length > 0 ? usernamesToIds(reviewers, memberList, 'Reviewer') : [];
    const assigneeIds = assignees.length > 0 ? usernamesToIds(assignees, memberList, 'Assignee') : [];

    const body = {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
      description,
      squash,
      remove_source_branch: removeSourceBranch
    };
    if (reviewerIds.length > 0) {
      body.reviewer_ids = reviewerIds;
    }
    if (assigneeIds.length > 0) {
      body.assignee_ids = assigneeIds;
    }

    const mr = await apiRequest(config, `/projects/${projectId}/merge_requests`, {
      method: 'POST',
      body
    });

    const url = mr && mr.web_url;
    if (!url) {
      throw new GitLabError('GitLab MR created but no web_url in response');
    }
    return { url, raw: JSON.stringify(mr) };
  } catch (error) {
    if (error instanceof GitLabError) {
      throw error;
    }
    throw new GitLabError(`Failed to create merge request: ${error.message}`);
  }
}

module.exports = {
  checkAuthStatus,
  ensureAuthenticated,
  getProjectMembers,
  createMergeRequest,
  getApiBase,
  getToken,
  parseRemoteUrl,
  normalizeGitlabHost
};
