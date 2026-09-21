'use strict';

const { execFile, spawn } = require('child_process');
const inquirer = require('inquirer');
const logger = require('../utils/logger');
const { GitLabError } = require('../utils/errors');

const GLAB_BIN = 'glab';

function execGlab(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      GLAB_BIN,
      args,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, cwd: process.cwd(), ...options },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          return reject(error);
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

async function isGlabInstalled() {
  try {
    await execGlab(['version']);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    // Installed but errored (e.g. not yet configured) still counts as "installed".
    return true;
  }
}

async function checkAuthStatus(hostname) {
  const args = ['auth', 'status', ...(hostname ? ['--hostname', hostname] : [])];
  try {
    const { stdout, stderr } = await execGlab(args);
    return { authenticated: true, raw: stdout + stderr };
  } catch (error) {
    return { authenticated: false, raw: (error.stdout || '') + (error.stderr || ''), error };
  }
}

function login(hostname) {
  return new Promise((resolve, reject) => {
    const args = ['auth', 'login', ...(hostname ? ['--hostname', hostname] : [])];
    const child = spawn(GLAB_BIN, args, { stdio: 'inherit', cwd: process.cwd() });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        reject(new GitLabError(`glab auth login exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function ensureAuthenticated(config) {
  if (!(await isGlabInstalled())) {
    throw new GitLabError(
      'glab CLI not found on PATH. Install it (https://gitlab.com/gitlab-org/cli#installation), then re-run.'
    );
  }

  const hostname = config.gitlab && config.gitlab.host ? config.gitlab.host : undefined;
  const status = await checkAuthStatus(hostname);
  if (status.authenticated) {
    logger.success('glab: authenticated with GitLab');
    return true;
  }

  logger.warn('glab is not authenticated with GitLab');
  const { doLogin } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'doLogin',
      message: 'Run `glab auth login` now to connect?',
      default: true
    }
  ]);

  if (!doLogin) {
    throw new GitLabError(
      'GitLab authentication is required to create merge requests. Re-run and log in, or disable release.autoCreateMR.'
    );
  }

  await login(hostname);

  const recheck = await checkAuthStatus(hostname);
  if (!recheck.authenticated) {
    throw new GitLabError('glab auth login completed but `glab auth status` still reports not authenticated.');
  }

  logger.success('glab: authentication successful');
  return true;
}

async function getProjectMembers() {
  try {
    const { stdout } = await execGlab(['api', 'projects/:id/members/all', '--paginate']);
    const data = JSON.parse(stdout);
    return data.map((m) => ({ id: m.id, username: m.username, name: m.name }));
  } catch (error) {
    throw new GitLabError(`Failed to list GitLab project members: ${error.stderr || error.message}`);
  }
}

async function createMergeRequest({
  sourceBranch,
  targetBranch,
  title,
  description,
  reviewers = [],
  squash = true,
  removeSourceBranch = true
}) {
  const args = [
    'mr',
    'create',
    '--source-branch', sourceBranch,
    '--target-branch', targetBranch,
    '--title', title,
    '--description', description,
    '--yes',
    '--no-editor'
  ];

  if (squash) {
    args.push('--squash-before-merge');
  }
  if (removeSourceBranch) {
    args.push('--remove-source-branch');
  }
  if (reviewers.length > 0) {
    args.push('--reviewer', reviewers.join(','));
  }

  try {
    const { stdout } = await execGlab(args);
    const match = stdout.match(/https?:\/\/\S+/);
    const url = match ? match[0] : null;
    if (!url) {
      throw new GitLabError(`glab mr create did not return a URL. Output: ${stdout}`);
    }
    return { url, raw: stdout };
  } catch (error) {
    if (error instanceof GitLabError) {
      throw error;
    }
    throw new GitLabError(`glab mr create failed: ${error.stderr || error.message}`);
  }
}

module.exports = {
  isGlabInstalled,
  checkAuthStatus,
  login,
  ensureAuthenticated,
  getProjectMembers,
  createMergeRequest
};
