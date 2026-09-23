'use strict';

const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const logger = require('../utils/logger');
const { loadConfig, configExists, saveConfig } = require('../config/loader');
const { setupWizard, ensureAiSettings } = require('../config/setup');
const { parseBranchListFile } = require('../git/branch-parser');
const { selectBranchesInteractively, getRemoteBranches, resolveBranchNameForTaskId } = require('../git/branch-selector');
const { createReleaseBranch, pushBranch } = require('../git/release-branch');
const { cherryPickCommits } = require('../git/cherry-pick');
const gitlab = require('../gitlab/client');
const { selectReviewer } = require('../gitlab/reviewer-selector');
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

  // Feature 1: if AI is enabled but provider/model were never saved, ask now and persist
  config = await ensureAiSettings(config);

  // Preflight: make sure we have a valid GitLab token before doing any GitLab work
  if (config.release.autoCreateMR) {
    await gitlab.ensureAuthenticated(config);
  }

  // Get branches to process
  let branches = [];

  if (options.file) {
    // Parse branches from file
    try {
      const branchList = parseBranchListFile(options.file);
      logger.info(`Loaded ${branchList.length} task(s) from file, resolving real branch names...`);

      const remoteBranches = await getRemoteBranches();

      for (const b of branchList) {
        const matches = await resolveBranchNameForTaskId(b.taskId, remoteBranches);
        let branchName;

        if (matches.length === 1) {
          branchName = matches[0];
          logger.info(`${b.taskId} -> ${branchName}`);
        } else if (matches.length > 1) {
          logger.warn(`Multiple remote branches match ${b.taskId}: ${matches.join(', ')}`);
          const { chosen } = await inquirer.prompt([
            {
              type: 'list',
              name: 'chosen',
              message: `Select the branch for ${b.taskId}:`,
              choices: matches
            }
          ]);
          branchName = chosen;
        } else {
          branchName = `feature/${b.taskId.toLowerCase()}`;
          logger.warn(`No remote branch found matching ${b.taskId}; guessing ${branchName} (may not exist)`);
        }

        branches.push({ taskId: b.taskId, description: b.description, branchName });
      }
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
    // Feature 2: use branches saved in configuration when present; otherwise select interactively
    const savedBranches = Array.isArray(config.release && config.release.branches)
      ? config.release.branches
      : [];

    let selectedBranches = [];

    if (savedBranches.length > 0) {
      const { useSaved } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useSaved',
          message: `Use ${savedBranches.length} branch(es) saved in configuration? (${savedBranches.join(', ')})`,
          default: true
        }
      ]);

      if (useSaved) {
        const remoteBranches = await getRemoteBranches();
        for (const saved of savedBranches) {
          if (remoteBranches.includes(saved)) {
            selectedBranches.push(saved);
          } else {
            logger.warn(`Saved branch no longer exists on remote: ${saved} (skipped)`);
          }
        }

        if (selectedBranches.length === 0) {
          logger.warn('No saved branches still exist on the remote; falling back to interactive selection');
        }
      }
    } else {
      logger.info('No branches saved in configuration yet; select them interactively');
    }

    if (selectedBranches.length === 0) {
      selectedBranches = await selectBranchesInteractively();
      if (selectedBranches.length === 0) {
        logger.warn('No branches selected');
        return;
      }

      const { saveSelection } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'saveSelection',
          message: 'Save this branch selection as default in configuration?',
          default: true
        }
      ]);

      if (saveSelection) {
        if (!config.release || typeof config.release !== 'object') {
          config.release = {};
        }
        config.release.branches = selectedBranches;
        saveConfig(config);
        logger.success(`Saved ${selectedBranches.length} branch(es) to configuration`);
      }
    }

    branches = selectedBranches.map(branch => ({
      taskId: branch.split('/').pop().toUpperCase(),
      description: branch,
      branchName: branch
    }));
  }

  // Process each branch
  const releaseStatus = new ReleaseStatus();
  let projectMembers = null;

  for (const branchInfo of branches) {
    logger.header(`Processing ${branchInfo.taskId}`);

    try {
      // Create release branch
      const releaseBranch = await createReleaseBranch(
        branchInfo.branchName,
        config.git.stagingBranch,
        config.git.branchPrefix
      );

      if (!releaseBranch.success) {
        releaseStatus.markNoProcede(branchInfo.taskId, releaseBranch.branch, [releaseBranch.reason]);
        continue;
      }

      // Cherry-pick only commits tagged "[taskId]" on this branch that aren't already on staging
      const cherryPickResult = await cherryPickCommits(branchInfo.branchName, branchInfo.taskId, config.git.stagingBranch);

      if (!cherryPickResult.success) {
        const conflictFiles = cherryPickResult.conflicts.flatMap(c => c.files);
        // Conflict: do nothing further for this branch (no push, no MR) — just record it.
        releaseStatus.markConflict(branchInfo.taskId, releaseBranch.branch, conflictFiles);
        continue;
      }

      if (cherryPickResult.commitsCherryPicked === 0) {
        // No real commits landed (either none were found tagged for this task, or they were
        // all already applied / empty diffs) — nothing to push or open an MR for.
        const reason = cherryPickResult.commitsAlreadyApplied > 0
          ? `Changes already present on ${config.git.stagingBranch} — nothing to release`
          : `No commits tagged [${branchInfo.taskId}] found on ${branchInfo.branchName}`;
        releaseStatus.markSkipped(branchInfo.taskId, releaseBranch.branch, reason);
        logger.warn(`${branchInfo.taskId}: ${reason}`);
        continue;
      }

      // Create MR if configured
      let mrLink = null;
      if (config.release.autoCreateMR) {
        try {
          await pushBranch(releaseBranch.branch);

          if (!projectMembers) {
            projectMembers = await gitlab.getProjectMembers(config);
          }
          const reviewers = await selectReviewer(projectMembers, config.release.defaultReviewerPattern);

          const mr = await createMR(config, {
            sourceBranch: releaseBranch.branch,
            targetBranch: config.git.stagingBranch,
            taskId: branchInfo.taskId,
            description: branchInfo.description,
            commits: cherryPickResult.commits,
            reviewers,
            members: projectMembers
          });
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

  // Offer to save the report to a file so conflicts are visible outside the console too
  const { saveReport } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'saveReport',
      message: 'Save release summary to release-summary.md?',
      default: true
    }
  ]);

  if (saveReport) {
    const markdown = generateMarkdownSummary(releaseStatus);
    const summaryPath = path.join(process.cwd(), 'release-summary.md');
    fs.writeFileSync(summaryPath, markdown, 'utf8');
    logger.success(`Saved ${summaryPath}`);
  }

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
