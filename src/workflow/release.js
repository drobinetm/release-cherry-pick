'use strict';

const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const logger = require('../utils/logger');
const { loadConfig, saveConfig } = require('../config/loader');
const { setupWizard, ensureAiSettings } = require('../config/setup');
const { parseBranchListFile, parseCommitSpecs, isCommitHash, extractTaskIdFromBranch, describeBranch, isTaskId } = require('../git/branch-parser');
const { selectBranchesInteractively, getBranchCatalog, countCommitsBetween, resolveBranchNameForTaskId } = require('../git/branch-selector');
const { buildReleaseBranchName, createReleaseBranch, pushBranch } = require('../git/release-branch');
const { captureStartingPoint, restoreStartingPoint, runInterruptible } = require('../git/repo-state');
const { cherryPickCommits, getCommitsToCherryPick, findLooseTaskCommits, orderCommitsByHistory, resolveExtraCommits } = require('../git/cherry-pick');
const gitlab = require('../gitlab/client');
const { configureGitCredentials } = require('../git/git-auth');
const { selectReviewer } = require('../gitlab/reviewer-selector');
const { createMR } = require('../gitlab/mr-creator');
const ReleaseStatus = require('../git/release-status');
const { generateMarkdownSummary } = require('../report/summary');
const { generateAgentsMd } = require('../doc/agents-generator');
const { generateRpdMd } = require('../doc/rpd-generator');
const { ConfigError, GitError } = require('../utils/errors');

async function runRelease(options = {}) {
  if (options.local && options.remote) {
    throw new ConfigError('--local and --remote cannot be used together');
  }
  if (options.local && options.listBranches) {
    throw new ConfigError('--local cannot be combined with --list-branches: that mode opens the MR straight from the source branch, which must exist on origin');
  }
  // --commits PB-123=abc1234,... : extra commits to cherry-pick per task (malformed values fail here)
  const commitsByTask = parseCommitSpecs(options.commits);

  logger.header('Release Cherry-Pick');
  if (options.listBranches && commitsByTask.size > 0) {
    logger.warn('--commits is ignored with --list-branches, which doesn\'t cherry-pick anything');
  }

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

  // If a GitLab token is configured (or entered just above), reuse it to authenticate git
  // fetch/pull/push against origin too, so an HTTPS remote doesn't prompt for a username/password
  // on every git operation for the rest of this run.
  await configureGitCredentials(config);

  // Get branches to process. Every source branch is listed once up front: local ones (by default)
  // plus origin's, the fallback for branches that don't exist locally.
  let branches = [];
  const sourceMode = resolveSourceMode(options, config);
  const catalog = await getBranchCatalog(config.git.branchPrefix, sourceMode);
  const branchNames = [...catalog.keys()].sort();

  if (options.file) {
    // Parse branches from file
    try {
      const branchList = parseBranchListFile(options.file);
      logger.info(`Loaded ${branchList.length} task(s) from file, resolving real branch names...`);
      branches = await resolveTasksToBranches(branchList, config.git.branchPrefix, branchNames, sourceMode);
    } catch (error) {
      logger.error(error.message);
      return;
    }
  } else if (options.branches) {
    // Comma-separated list: each entry may be a bare task ID ("PB-123", resolved to its real
    // branch) or a full branch name ("feature/PB-123-list-user")
    const entries = options.branches.split(',').map(b => b.trim()).filter(Boolean);
    const taskIds = entries.filter(isTaskId);
    const resolved = await resolveTasksToBranches(
      taskIds.map(taskId => ({ taskId })),
      config.git.branchPrefix,
      branchNames,
      sourceMode
    );

    for (const entry of entries) {
      if (isTaskId(entry)) {
        branches.push(resolved.find(b => b.taskId === entry.toUpperCase()));
      } else {
        const info = branchInfoFromName(entry, config);
        if (info) {
          if (!catalog.has(info.branchName)) {
            info.missingReason = await describeMissingBranch(info, branchNames, config.git.branchPrefix, sourceMode);
          }
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
        for (const saved of savedBranches) {
          if (catalog.has(saved)) {
            selectedBranches.push(saved);
          } else {
            logger.warn(`Saved branch no longer exists ${describeLocation(sourceMode)}: ${saved} (skipped)`);
          }
        }

        if (selectedBranches.length === 0) {
          logger.warn(`No saved branches still exist ${describeLocation(sourceMode)}; falling back to interactive selection`);
        }
      }
    } else {
      logger.info('No branches saved in configuration yet; select them interactively');
    }

    if (selectedBranches.length === 0) {
      selectedBranches = await selectBranchesInteractively(config.git.branchPrefix, branchNames);
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

  // Decide which ref each branch is released from: the local branch or origin's copy
  await attachSourceRefs(branches, catalog, sourceMode);
  attachExtraHashes(branches, commitsByTask);

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

      if (branchInfo.missingReason) {
        logger.error(branchInfo.missingReason);
        releaseStatus.markNoProcede(
          branchInfo.taskId,
          buildReleaseBranchName(branchInfo.branchName, config.git.branchPrefix),
          [branchInfo.missingReason]
        );
        continue;
      }

      try {
        // Pick the commits first: it may prompt, and an invalid commit hash should fail before
        // any release branch is created. Only commits tagged "[taskId]" that aren't on staging,
        // plus — if the user agrees — the ones mentioning the task without following the
        // convention, plus any given by hash.
        const commits = options.listBranches ? null : await selectTaskCommits(branchInfo, config, releaseStatus);
        if (signal.interrupted) break;

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

        if (options.listBranches) {
          // -l: skip cherry-pick entirely. The release branch is left identical to staging —
          // it's only a reserved name for this task — and the MR is opened straight from the
          // original source branch into staging, so GitLab (not this tool) does the actual merge.
          let mrLink = null;
          if (config.release.autoCreateMR) {
            try {
              await pushBranch(releaseBranch.branch);
              unfinishedBranch = null;
              if (signal.interrupted) break;

              if (!projectMembers) {
                projectMembers = await gitlab.getProjectMembers(config);
              }
              const reviewers = await selectReviewer(projectMembers, config.release);
              if (signal.interrupted) break;

              // Commits are only read to build the MR description text, nothing is cherry-picked
              // here — so merge commits are kept in the list instead of being excluded/warned
              // about as "can't cherry-pick a merge", which wouldn't apply in this mode.
              const commits = await getCommitsToCherryPick(branchInfo.branchName, branchInfo.taskId, config.git.stagingBranch, {
                excludeMerges: false,
                sourceRef: branchInfo.sourceRef
              });

              const mr = await createMR(config, {
                sourceBranch: branchInfo.branchName,
                targetBranch: config.git.stagingBranch,
                taskId: branchInfo.taskId,
                description: branchInfo.description,
                commits,
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
          logger.success(`${branchInfo.taskId} completed successfully (no cherry-pick — MR opened from ${branchInfo.branchName})`);
          continue;
        }

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

  // Optional final recap: just the release branches this run actually created and kept (PROCEDE),
  // handy for scripting/copy-paste instead of parsing the full status report above.
  if (options.listBranches) {
    const createdBranches = releaseStatus.getCreatedBranches();
    logger.header('Release Branches Created');
    if (createdBranches.length === 0) {
      logger.info('No release branches were created in this run');
    } else {
      for (const branch of createdBranches) {
        logger.log(`  - ${branch}`);
      }
    }
  }

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

// Resolves each { taskId, description? } to its real branch among `branchNames`; prompts when
// several match. Tasks without a description (bare IDs from -b) get one derived from the branch name.
async function resolveTasksToBranches(tasks, branchPrefix = {}, branchNames = [], source = 'local') {
  const branches = [];

  for (const task of tasks) {
    const taskId = task.taskId.toUpperCase();
    const matches = await resolveBranchNameForTaskId(taskId, branchNames, branchPrefix);
    let branchName;
    let missingReason = null;

    if (matches.length === 1) {
      branchName = matches[0];
      logger.info(`${taskId} -> ${branchName}`);
    } else if (matches.length > 1) {
      logger.warn(`Multiple branches match ${taskId}: ${matches.join(', ')}`);
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
      // Only labels the task in the summary; it's reported as not processed
      branchName = `${branchPrefix.feature || 'feature/'}${taskId.toLowerCase()}`;
      missingReason = `No branch found ${describeLocation(source)} matching ${taskId}`;
    }

    const description = task.description || describeBranch(branchName, branchPrefix);
    const branchInfo = { taskId, description, branchName };
    if (task.extraCommits && task.extraCommits.length > 0) {
      branchInfo.extraHashes = [...task.extraCommits];
    }
    if (missingReason) {
      branchInfo.missingReason = missingReason;
    }
    branches.push(branchInfo);
  }

  return branches;
}

// 'local' (the default, from config.git.branchSource) or 'remote', overridden by --local/--remote.
// --list-branches opens each MR straight from the source branch, so that branch must be on origin.
function resolveSourceMode(options, config) {
  if (options.remote) return 'remote';
  if (options.local) return 'local';
  const configured = config.git.branchSource || 'local';
  if (options.listBranches) {
    if (configured === 'local') {
      logger.info('--list-branches opens each MR from the source branch, so branches are resolved on origin');
    }
    return 'remote';
  }
  return configured;
}

function describeLocation(source) {
  return source === 'local' ? 'locally or on origin' : 'on origin';
}

// Sets branchInfo.sourceRef: the local branch when it exists locally (in local mode), origin's copy
// otherwise. A local branch missing commits that are on origin would silently leave them out of the
// release, so in that case the user picks which version to release (default: origin's).
async function attachSourceRefs(branches, catalog, source) {
  for (const branchInfo of branches) {
    if (branchInfo.missingReason) continue;
    const { branchName, taskId } = branchInfo;
    const where = catalog.get(branchName);
    const remoteRef = `origin/${branchName}`;

    if (!where) {
      branchInfo.missingReason = `Branch ${branchName} not found ${describeLocation(source)}`;
      continue;
    }

    if (source !== 'local' || !where.local) {
      branchInfo.sourceRef = remoteRef;
      if (source === 'local') {
        logger.info(`${taskId}: ${branchName} doesn't exist locally, using ${remoteRef}`);
      }
      continue;
    }

    branchInfo.sourceRef = branchName;
    if (!where.remote) continue;

    const behind = await countCommitsBetween(branchName, remoteRef);
    if (behind === 0) continue;

    const ahead = await countCommitsBetween(remoteRef, branchName);
    logger.warn(`${taskId}: local ${branchName} is missing ${behind} commit(s) that are on ${remoteRef}` +
      (ahead > 0 ? `, and has ${ahead} commit(s) not pushed` : ''));
    const { chosen } = await inquirer.prompt([
      {
        type: 'list',
        name: 'chosen',
        message: `Which version of ${branchName} should be released?`,
        choices: [
          { name: `${remoteRef} (includes the ${behind} commit(s) from origin)`, value: remoteRef },
          { name: `Local ${branchName} as it is${ahead > 0 ? ` (includes the ${ahead} unpushed commit(s))` : ''}`, value: branchName }
        ],
        default: remoteRef
      }
    ]);
    branchInfo.sourceRef = chosen;
  }
}

// The commits to release for a task: the ones tagged "[TASK-ID] ..." and, when some commits mention
// the task ID without following that convention (e.g. "PB-700: fix"), the user decides whether to
// include them too (default: no). Either way it's recorded as a note in the release summary, so a
// partially released task never goes unnoticed.
async function selectTaskCommits(branchInfo, config, releaseStatus) {
  const { branchName, taskId } = branchInfo;
  const base = config.git.stagingBranch;
  const sourceOptions = { sourceRef: branchInfo.sourceRef };
  const tagged = await getCommitsToCherryPick(branchName, taskId, base, sourceOptions);
  const loose = await findLooseTaskCommits(branchName, taskId, base, sourceOptions);
  let commits = tagged;

  if (loose.length > 0) {
    const list = loose.map(describeCommit);
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
    if (includeLoose) {
      commits = [...tagged, ...loose];
    }
  }

  // Commits given by hash (task file "[+hash]" or --commits); with none given and nothing found,
  // offer to type them, as a commit with no task ID at all can't be found any other way
  let hashes = branchInfo.extraHashes || [];
  if (hashes.length === 0 && commits.length === 0) {
    hashes = await askForCommitHashes(branchInfo);
  }
  if (hashes.length > 0) {
    const added = await addCommitsByHash(hashes, commits, branchInfo, base, releaseStatus);
    if (added.length > 0) {
      commits = [...commits, ...added];
    }
  }

  return commits.length > tagged.length
    ? orderCommitsByHistory(branchName, commits, base, sourceOptions)
    : commits;
}

// Validates commit hashes given for a task and returns the ones to cherry-pick on top of `current`.
// Unknown/ambiguous hashes and merge commits fail the task (nothing has been created yet); commits
// already on staging are skipped with a note; commits not on the source branch need confirmation.
async function addCommitsByHash(hashes, current, branchInfo, base, releaseStatus) {
  const { taskId, branchName } = branchInfo;
  const resolved = await resolveExtraCommits(hashes, { sourceRef: branchInfo.sourceRef, baseBranch: base });

  if (resolved.errors.length > 0) {
    throw new GitError(`Invalid commit(s) for ${taskId}: ${resolved.errors.join('; ')}`);
  }

  if (resolved.alreadyOnBase.length > 0) {
    const list = resolved.alreadyOnBase.map(describeCommit);
    logger.warn(`${taskId}: ${list.length} commit(s) given by hash are already on ${base} — skipped: ${list.join('; ')}`);
    releaseStatus.addNote(taskId, `${list.length} commit(s) given by hash were already on ${base} and were skipped: ${list.join('; ')}`);
  }

  let candidates = resolved.commits;
  if (resolved.offBranch.length > 0) {
    const list = resolved.offBranch.map(describeCommit);
    logger.warn(`${taskId}: ${list.length} commit(s) given by hash are not on ${branchName}:`);
    for (const line of list) {
      logger.warn(`  ${line}`);
    }
    const { includeOffBranch } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'includeOffBranch',
        message: `Include ${list.length === 1 ? 'it' : 'them'} in the ${taskId} release anyway?`,
        default: false
      }
    ]);
    if (!includeOffBranch) {
      const off = new Set(resolved.offBranch.map(c => c.hash));
      candidates = candidates.filter(c => !off.has(c.hash));
      releaseStatus.addNote(taskId, `${list.length} commit(s) given by hash are not on ${branchName} and were NOT included: ${list.join('; ')}`);
    }
  }

  const present = new Set(current.map(c => c.hash));
  const added = candidates.filter(c => !present.has(c.hash));
  if (added.length > 0) {
    const list = added.map(describeCommit);
    logger.info(`${taskId}: adding ${added.length} commit(s) given by hash: ${list.join('; ')}`);
    releaseStatus.addNote(taskId, `${added.length} commit(s) added by hash: ${list.join('; ')}`);
  }
  return added;
}

// Asked when a task has no commits to release: the commit may just be missing its "[TASK-ID]" tag
async function askForCommitHashes({ taskId, branchName }) {
  const { enterHashes } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enterHashes',
      message: `No commits tagged "[${taskId}] ..." found on ${branchName}. Enter the hash(es) of the commit(s) to release?`,
      default: false
    }
  ]);
  if (!enterHashes) {
    return [];
  }

  const { commitHashes } = await inquirer.prompt([
    {
      type: 'input',
      name: 'commitHashes',
      message: 'Commit hash(es), comma-separated (blank to skip):',
      filter: (value) => String(value || '').split(',').map(hash => hash.trim()).filter(Boolean),
      validate: (value) => {
        const list = Array.isArray(value) ? value : String(value || '').split(',').map(h => h.trim()).filter(Boolean);
        const bad = list.filter(hash => !isCommitHash(hash));
        return bad.length === 0 || `Not commit hashes: ${bad.join(', ')}`;
      }
    }
  ]);
  return commitHashes;
}

// Adds the --commits hashes to each task's own (from the task file); warns about task IDs in
// --commits that aren't part of this release.
function attachExtraHashes(branches, commitsByTask) {
  for (const [taskId, hashes] of commitsByTask) {
    const targets = branches.filter(b => b && b.taskId === taskId);
    if (targets.length === 0) {
      logger.warn(`--commits ${taskId}=... ignored: ${taskId} is not part of this release`);
      continue;
    }
    for (const branchInfo of targets) {
      branchInfo.extraHashes = [...new Set([...(branchInfo.extraHashes || []), ...hashes])];
    }
  }
}

function describeCommit(commit) {
  return `${commit.hash.slice(0, 8)} ${commit.message}`;
}

// Why a branch given by full name can't be released: it doesn't exist (typo, other name, already
// deleted). Lists the branches of the same task so the user can spot the right name.
async function describeMissingBranch({ branchName, taskId }, branchNames, branchPrefix, source = 'local') {
  const similar = await resolveBranchNameForTaskId(taskId, branchNames, branchPrefix);
  const location = describeLocation(source);
  const hint = similar.length > 0
    ? ` Branches ${location} for ${taskId}: ${similar.join(', ')}`
    : ` No branch ${location} matches ${taskId}.`;
  return `Branch ${branchName} not found ${location}.${hint}`;
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
