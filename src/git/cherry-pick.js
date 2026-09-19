'use strict';

const simpleGit = require('simple-git');
const logger = require('../utils/logger');
const { GitError } = require('../utils/errors');

const git = simpleGit();

async function cherryPickCommits(sourceBranch, fromCommit = null) {
  logger.info(`Cherry-picking from ${sourceBranch}`);

  try {
    // Get commits from source branch
    const commits = await getCommitsToCherryPick(sourceBranch, fromCommit);

    if (commits.length === 0) {
      logger.warn('No commits to cherry-pick');
      return { success: true, commitsCherryPicked: 0, conflicts: [] };
    }

    logger.info(`Found ${commits.length} commits to cherry-pick`);

    const conflicts = [];

    for (const commit of commits) {
      try {
        await git.cherryPick(commit.hash);
        logger.info(`Cherry-picked: ${commit.message.substring(0, 50)}...`);
      } catch (error) {
        if (error.message.includes('CONFLICT')) {
          conflicts.push({
            commit: commit.hash,
            message: commit.message,
            files: await getConflictingFiles()
          });
          logger.error(`Conflict detected in commit: ${commit.hash}`);

          // Abort the cherry-pick
          await git.cherryPick(['--abort']);
        } else {
          throw new GitError(`Cherry-pick failed: ${error.message}`);
        }
      }
    }

    return {
      success: conflicts.length === 0,
      commitsCherryPicked: commits.length - conflicts.length,
      conflicts
    };
  } catch (error) {
    throw new GitError(`Cherry-pick operation failed: ${error.message}`);
  }
}

async function getCommitsToCherryPick(sourceBranch, fromCommit = null) {
  try {
    await git.fetch();

    let range = `origin/${sourceBranch}`;
    if (fromCommit) {
      range = `${fromCommit}..origin/${sourceBranch}`;
    }

    const log = await git.log([range]);
    return log.all.map(commit => ({
      hash: commit.hash,
      message: commit.message,
      date: commit.date
    }));
  } catch (error) {
    throw new GitError(`Failed to get commits: ${error.message}`);
  }
}

async function getConflictingFiles() {
  try {
    const status = await git.status();
    return status.conflicted;
  } catch (error) {
    return [];
  }
}

async function abortCherryPick() {
  try {
    await git.cherryPick(['--abort']);
    logger.info('Cherry-pick aborted');
    return true;
  } catch (error) {
    logger.error(`Failed to abort cherry-pick: ${error.message}`);
    return false;
  }
}

module.exports = {
  cherryPickCommits,
  getCommitsToCherryPick,
  getConflictingFiles,
  abortCherryPick
};
