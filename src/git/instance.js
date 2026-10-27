'use strict';

const { simpleGit } = require('simple-git');

// simple-git v4 strips ambient `GIT_*` variables from the environment of the git child process
// (they can change which program git runs), so they must be allowed explicitly. git-auth.js hands
// the GitLab token to git through GIT_CONFIG_COUNT/KEY/VALUE — injected per process, never written
// to disk — and those three would otherwise be dropped silently, sending every HTTPS fetch/pull/push
// back to git's interactive username/password prompt.
const ALLOWED_ENVIRONMENT = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];

// Every simple-git instance in the app is created here so the allow-list above always applies.
function createGit() {
  return simpleGit({ allowEnvironment: ALLOWED_ENVIRONMENT });
}

module.exports = { createGit, ALLOWED_ENVIRONMENT };
