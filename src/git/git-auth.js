'use strict';

const { createGit } = require('./instance');

function getToken(config) {
  return (config && config.gitlab && config.gitlab.token) || process.env.GITLAB_TOKEN || '';
}

// Makes every git subprocess for the rest of this process authenticate to the `origin` remote
// with the configured GitLab token, so `git fetch`/`pull`/`push` over HTTPS don't fall back to
// git's own interactive username/password prompt — the whole point of configuring a token is to
// not be asked for credentials again. SSH origins already authenticate via the user's key and are
// left untouched. The header is injected only for this process, through env vars git itself reads
// (GIT_CONFIG_COUNT/KEY/VALUE, supported since Git 2.31) — it is never written to .git/config, so
// the token never lingers in the target repo once the CLI exits. simple-git v4 strips ambient GIT_*
// variables from the child process, so those three are allow-listed in ./instance.js — without it
// this header would be dropped silently. GitLab's git-over-HTTP Basic auth validates the token
// itself and doesn't check the username, so any non-blank placeholder works.
// No-op without a token configured, or when origin isn't http(s).
async function configureGitCredentials(config) {
  const token = getToken(config);
  if (!token) {
    return;
  }

  let remoteUrl;
  try {
    remoteUrl = (await createGit().raw(['remote', 'get-url', 'origin'])).trim();
  } catch {
    return;
  }

  if (!/^https?:\/\//i.test(remoteUrl)) {
    return;
  }

  const basicAuth = Buffer.from(`oauth2:${token}`).toString('base64');
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = 'http.extraheader';
  process.env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basicAuth}`;
}

module.exports = { configureGitCredentials, getToken };
