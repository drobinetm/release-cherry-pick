'use strict';

const inquirer = require('inquirer');
const simpleGit = require('simple-git');
const logger = require('../utils/logger');
const { GitLabError } = require('../utils/errors');
const { saveConfig } = require('../config/loader');

const git = simpleGit();
const DEFAULT_HOST = 'gitlab.com';

function getApiBase(config) {
  const host = (config.gitlab && config.gitlab.host) || DEFAULT_HOST;
  const trimmed = String(host).trim().replace(/\/+$/, '');
  const origin = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return `${origin}/api/v4`;
}

function getToken(config) {
  return (config.gitlab && config.gitlab.token) || process.env.GITLAB_TOKEN || '';
}

// Resolves the project path (e.g. "group/sub/proj") from the `origin` remote URL,
// URL-encoding it for use as `:id` in GitLab API paths.
async function getProjectPathId() {
  let url;
  try {
    url = (await git.raw(['remote', 'get-url', 'origin'])).trim();
  } catch (error) {
    throw new GitLabError(`Could not read git remote "origin": ${error.message}`);
  }

  let projectPath;
  if (url.includes(':')) {
    // SCP-like: git@host:group/proj.git
    projectPath = url.slice(url.indexOf(':') + 1);
  } else {
    try {
      projectPath = new URL(url).pathname;
    } catch {
      throw new GitLabError(`Could not parse origin remote URL: ${url}`);
    }
  }

  projectPath = projectPath.replace(/^\/+/, '').replace(/\.git$/, '');
  if (!projectPath) {
    throw new GitLabError(`Could not derive project path from origin remote: ${url}`);
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

  const base = getApiBase(config);
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
    throw new GitLabError('GitLab resource not found (404): check gitlab.host, origin remote, and token access');
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
        type: 'input',
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
    const projectId = await getProjectPathId();
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

async function createMergeRequest(
  config,
  { sourceBranch, targetBranch, title, description, reviewers = [], squash = true, removeSourceBranch = true, members = null }
) {
  try {
    const projectId = await getProjectPathId();

    let reviewerIds = [];
    if (reviewers.length > 0) {
      const memberList = members || (await getProjectMembers(config));
      reviewerIds = reviewers
        .map((username) => {
          const match = memberList.find((m) => m.username === username);
          return match ? match.id : null;
        })
        .filter((id) => id !== null);
      const missing = reviewers.filter(
        (username) => !memberList.some((m) => m.username === username)
      );
      if (missing.length > 0) {
        logger.warn(`Reviewer(s) not found in project members (skipped): ${missing.join(', ')}`);
      }
    }

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
  getToken
};
