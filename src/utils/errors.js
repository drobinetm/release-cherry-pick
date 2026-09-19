'use strict';

class AppError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR') {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

class ConfigError extends AppError {
  constructor(message) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

class GitError extends AppError {
  constructor(message) {
    super(message, 'GIT_ERROR');
    this.name = 'GitError';
  }
}

class GitLabError extends AppError {
  constructor(message) {
    super(message, 'GITLAB_ERROR');
    this.name = 'GitLabError';
  }
}

function handleError(error) {
  if (error instanceof AppError) {
    console.error(`Error [${error.code}]:`, error.message);
  } else {
    console.error('Unexpected error:', error.message);
  }
  process.exit(1);
}

module.exports = {
  AppError,
  ConfigError,
  GitError,
  GitLabError,
  handleError
};
