'use strict';

const inquirer = require('inquirer');
const logger = require('../utils/logger');
const { loadConfig, configExists } = require('../config/loader');
const { setupWizard } = require('../config/setup');
const { parseBranchListFile } = require('../git/branch-parser');
const { selectBranchesInteractively } = require('../git/branch-selector');
const { createReleaseBranch } = require('../git/release-branch');
const { cherryPickCommits } = require('../git/cherry-pick');
const { getCommits } = require('../gitlab/client');
const { createMR } = require('../gitlab/mr-creator');
const ReleaseStatus = require('../git/release-status');
const { generateMarkdownSummary } = require('../report/summary');
const { generateAgentsMd } = require('../doc/agents-generator');
const { generateRpdMd } = require('../doc/rpd-generator');
const { ConfigError } = require('../utils/errors');

async function runRelease(options = {}) {
  logger.header('Release Cherry-Pick');

  // Check and setup configuration
  let config = loadConfig();
  if (!config) {
    logger.warn('Configuration not found');
    const { setupNow } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'setupNow',
        message: 'Do you want to set up configuration now?',
        default: true
      }
    ]);

    if (setupNow) {
      config = await setupWizard();
      if (!config) {
        logger.error('Configuration setup cancelled');
        return;
      }
    } else {
      logger.error('Configuration is required');
      return;
    }
  }

  // Get branches to process
  let branches = [];

  if (options.file) {
    // Parse branches from file
    try {
      const branchList = parseBranchListFile(options.file);
      branches = branchList.map(b => ({
        taskId: b.taskId,
        description: b.description,
        branchName: `feature/${b.taskId.toLowerCase()}`
      }));
      logger.info(`Loaded ${branches.length} branches from file`);
    } catch (error) {
      logger.error(error.message);
      return;
    }
  } else if (options.branches) {
    // Parse comma-separated branches
    const branchNames = options.branches.split(',').map(b => b.trim());
    branches = branchNames.map(branch => ({
      taskId: branch.split('/').pop().toUpperCase(),
      description: branch,
      branchName: branch
    }));
  } else {
    // Interactive selection
    const selectedBranches = await selectBranchesInteractively();
    if (selectedBranches.length === 0) {
      logger.warn('No branches selected');
      return;
    }
    branches = selectedBranches.map(branch => ({
      taskId: branch.split('/').pop().toUpperCase(),
      description: branch,
      branchName: branch
    }));
  }

  // Process each branch
  const releaseStatus = new ReleaseStatus();

  for (const branchInfo of branches) {
    logger.header(`Processing ${branchInfo.taskId}`);

    try {
      // Create release branch
      const releaseBranch = await createReleaseBranch(
        branchInfo.branchName,
        branchInfo.taskId,
        config.git.stagingBranch
      );

      if (!releaseBranch.success) {
        releaseStatus.markNoProcede(branchInfo.taskId, releaseBranch.branch);
        continue;
      }

      // Cherry-pick commits
      const cherryPickResult = await cherryPickCommits(branchInfo.branchName);

      if (!cherryPickResult.success) {
        const conflictFiles = cherryPickResult.conflicts.flatMap(c => c.files);
        releaseStatus.markNoProcede(releaseBranch.branch, conflictFiles);
        continue;
      }

      // Create MR if configured
      let mrLink = null;
      if (config.release.autoCreateMR) {
        try {
          const commits = await getCommits(config, branchInfo.branchName);
          const mr = await createMR(config, releaseBranch.branch, branchInfo.taskId, branchInfo.description, commits);
          mrLink = mr.url;
        } catch (error) {
          logger.warn(`Failed to create MR: ${error.message}`);
        }
      }

      releaseStatus.markProcede(branchInfo.taskId, releaseBranch.branch, mrLink);
      logger.success(`${branchInfo.taskId} completed successfully`);

    } catch (error) {
      logger.error(`Failed to process ${branchInfo.taskId}: ${error.message}`);
      releaseStatus.markNoProcede(branchInfo.taskId, 'unknown', [error.message]);
    }
  }

  // Display summary
  releaseStatus.displaySummary();

  // Generate documentation
  const { generateDocs } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'generateDocs',
      message: 'Generate AGENTS.md and RPD.md?',
      default: true
    }
  ]);

  if (generateDocs) {
    await generateAgentsMd(process.cwd());
    await generateRpdMd(process.cwd(), releaseStatus);
  }

  logger.success('Release process completed');
}

module.exports = { runRelease };
