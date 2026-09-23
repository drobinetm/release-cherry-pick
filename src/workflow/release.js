'use strict';

const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const logger = require('../utils/logger');
const { loadConfig, saveConfig } = require('../config/loader');
const { setupWizard, ensureAiSettings } = require('../config/setup');
const { parseBranchListFile, extractTaskIdFromBranch, describeBranch, isTaskId } = require('../git/branch-parser');
const { selectBranchesInteractively, getRemoteBranches, resolveBranchNameForTaskId } = require('../git/branch-selector');
const { buildReleaseBranchName, createReleaseBranch, pushBranch } = require('../git/release-branch');
const { captureStartingPoint, restoreStartingPoint, runInterruptible } = require('../git/repo-state');
const { cherryPickCommits, getCommitsToCherryPick, findLooseTaskCommits, orderCommitsByHistory } = require('../git/cherry-pick');
const gitlab = require('../gitlab/client');
const { selectReviewer } = require('../gitlab/reviewer-selector');
const { createMR } = require('../gitlab/mr-creator');
const ReleaseStatus = require('../git/release-status');
const { generateMarkdownSummary } = require('../report/summary');
const { generateAgentsMd } = require('../doc/agents-generator');
const { generateRpdMd } = require('../doc/rpd-generator');

async function runRelease(options = {}) {
  logger.header('Release Cherry-Pick');

  // Fail fast (before any prompt) on uncommitted changes / a cherry-pick in progress, and remember
  // where HEAD is so it can be restored once all branches are processed
  const startingPoint = await captureStartingPoint();

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
      branches = await resolveTasksToBranches(branchList, config.git.branchPrefix);
    } catch (error) {
      logger.error(error.message);
      return;
    }
  } else if (options.branches) {
    // Comma-separated list: each entry may be a bare task ID ("PB-123", resolved to its real
    // remote branch) or a full branch name ("feature/PB-123-list-user")
    const entries = options.branches.split(',').map(b => b.trim()).filter(Boolean);
    const taskIds = entries.filter(isTaskId);
    const resolved = await resolveTasksToBranches(
      taskIds.map(taskId => ({ taskId })),
      config.git.branchPrefix
    );

    for (const entry of entries) {
      if (isTaskId(entry)) {
        branches.push(resolved.find(b => b.taskId === entry.toUpperCase()));
      } else {
        const info = branchInfoFromName(entry, config);
        if (info) {
          branches.push(info);
        }
      }
    }
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
        const remoteBranches = await getRemoteBranches(config.git.branchPrefix);
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
      selectedBranches = await selectBranchesInteractively(config.git.branchPrefix);
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

    branches = selectedBranches.map(branch => branchInfoFromName(branch, config)).filter(Boolean);
  }

  // Process each branch
  const releaseStatus = new ReleaseStatus();
  let projectMembers = null;
  // Release branches created in this run that ended up with nothing worth keeping (conflict,
  // skipped, error): they were never pushed and equal staging, so they're deleted at the end
  const emptyBranches = [];
  // The branch being processed right now, while it's still local-only; if Ctrl+C interrupts it
  // midway, it's unfinished and unpushed, so it's discarded too
  let unfinishedBranch = null;

  // Cleanup (return to the starting branch, delete empty release branches) runs when the loop
  // ends, if it throws, and on Ctrl+C
  await runInterruptible(async (signal) => {
    for (const branchInfo of branches) {
      if (signal.interrupted) break;
      logger.header(`Processing ${branchInfo.taskId}`);
      let createdBranch = null;

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
        createdBranch = releaseBranch.branch;
        unfinishedBranch = createdBranch;
        if (signal.interrupted) break;

        // Cherry-pick only commits tagged "[taskId]" on this branch that aren't already on staging,
        // plus — if the user agrees — the ones mentioning the task without following the convention
        const commits = await selectTaskCommits(branchInfo, config, releaseStatus);
        if (signal.interrupted) break;
        const cherryPickResult = await cherryPickCommits(branchInfo.branchName, branchInfo.taskId, config.git.stagingBranch, commits);
        if (signal.interrupted) break;

        if (!cherryPickResult.success) {
          const conflictFiles = cherryPickResult.conflicts.flatMap(c => c.files);
          // Conflict: do nothing further for this branch (no push, no MR) — just record it.
          releaseStatus.markConflict(branchInfo.taskId, releaseBranch.branch, conflictFiles);
          emptyBranches.push(createdBranch);
          unfinishedBranch = null;
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
          emptyBranches.push(createdBranch);
          unfinishedBranch = null;
          continue;
        }

        // Create MR if configured
        let mrLink = null;
        if (config.release.autoCreateMR) {
          try {
            await pushBranch(releaseBranch.branch);
            // Pushed: from here on the branch is kept even if interrupted
            unfinishedBranch = null;
            if (signal.interrupted) break;

            if (!projectMembers) {
              projectMembers = await gitlab.getProjectMembers(config);
            }
            const reviewers = await selectReviewer(projectMembers, config.release);
            if (signal.interrupted) break;

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
            if (signal.interrupted) break;
            logger.warn(`Failed to create MR: ${error.message}`);
          }
        }

        releaseStatus.markProcede(branchInfo.taskId, releaseBranch.branch, mrLink);
        unfinishedBranch = null;
        logger.success(`${branchInfo.taskId} completed successfully`);

      } catch (error) {
        // Ctrl+C also kills the running git command, so its error is expected — just stop
        if (signal.interrupted) break;
        logger.error(`Failed to process ${branchInfo.taskId}: ${error.message}`);
        const branchLabel = createdBranch || buildReleaseBranchName(branchInfo.branchName, config.git.branchPrefix);
        releaseStatus.markNoProcede(branchInfo.taskId, branchLabel, [error.message]);
        // Errors before the push leave an unpushed branch behind (push failures are handled above
        // and keep the branch as PROCEDE), so it's safe to discard
        if (unfinishedBranch) {
          emptyBranches.push(unfinishedBranch);
          unfinishedBranch = null;
        }
      }
    }
  }, () => restoreStartingPoint(
    startingPoint,
    unfinishedBranch ? [...emptyBranches, unfinishedBranch] : emptyBranches
  ));

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

// Resolves each { taskId, description? } to its real remote branch; prompts when several match.
// Tasks without a description (bare IDs from -b) get one derived from the resolved branch name.
async function resolveTasksToBranches(tasks, branchPrefix = {}) {
  if (tasks.length === 0) {
    return [];
  }

  const remoteBranches = await getRemoteBranches(branchPrefix);
  const branches = [];

  for (const task of tasks) {
    const taskId = task.taskId.toUpperCase();
    const matches = await resolveBranchNameForTaskId(taskId, remoteBranches, branchPrefix);
    let branchName;

    if (matches.length === 1) {
      branchName = matches[0];
      logger.info(`${taskId} -> ${branchName}`);
    } else if (matches.length > 1) {
      logger.warn(`Multiple remote branches match ${taskId}: ${matches.join(', ')}`);
      const { chosen } = await inquirer.prompt([
        {
          type: 'list',
          name: 'chosen',
          message: `Select the branch for ${taskId}:`,
          choices: matches
        }
      ]);
      branchName = chosen;
    } else {
      branchName = `${branchPrefix.feature || 'feature/'}${taskId.toLowerCase()}`;
      logger.warn(`No remote branch found matching ${taskId}; guessing ${branchName} (may not exist)`);
    }

    const description = task.description || describeBranch(branchName, branchPrefix);
    branches.push({ taskId, description, branchName });
  }

  return branches;
}

// The commits to release for a task: the ones tagged "[TASK-ID] ..." and, when some commits mention
// the task ID without following that convention (e.g. "PB-700: fix"), the user decides whether to
// include them too (default: no). Either way it's recorded as a note in the release summary, so a
// partially released task never goes unnoticed.
async function selectTaskCommits(branchInfo, config, releaseStatus) {
  const { branchName, taskId } = branchInfo;
  const base = config.git.stagingBranch;
  const tagged = await getCommitsToCherryPick(branchName, taskId, base);
  const loose = await findLooseTaskCommits(branchName, taskId, base);
  if (loose.length === 0) {
    return tagged;
  }

  const list = loose.map(c => `${c.hash.slice(0, 8)} ${c.message}`);
  logger.warn(`${loose.length} commit(s) on ${branchName} mention ${taskId} but don't follow the "[${taskId}] ..." convention:`);
  for (const line of list) {
    logger.warn(`  ${line}`);
  }

  const { includeLoose } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'includeLoose',
      message: `Include ${loose.length === 1 ? 'it' : 'them'} in the ${taskId} release too?`,
      default: false
    }
  ]);

  const outcome = includeLoose ? 'included at your request' : 'NOT included';
  releaseStatus.addNote(taskId, `${loose.length} commit(s) mention ${taskId} without the "[${taskId}] ..." convention and were ${outcome}: ${list.join('; ')}`);

  return includeLoose ? orderCommitsByHistory(branchName, [...tagged, ...loose], base) : tagged;
}

// Builds branch info from a full branch name, extracting its task ID; null (with a warning) if none.
function branchInfoFromName(branchName, config) {
  const taskId = extractTaskIdFromBranch(branchName, config.git.branchPrefix);
  if (!taskId) {
    logger.warn(`Could not extract a task ID from ${branchName} — skipping it`);
    return null;
  }
  return { taskId, description: describeBranch(branchName, config.git.branchPrefix), branchName };
}

module.exports = { runRelease };
