# CLAUDE.md

This file gives Claude Code context on the `release-cherry-pick` repository.

## Project overview

`release-cherry-pick` is a Node.js CLI (built on Commander) that automates release cherry-picking and GitLab merge-request creation. It's designed to be installed/run as an **external tool from inside another git repo** (the "target" project being released) — this repo is the tool itself, not a project that gets released.

- Entry point / bin: `src/index.js` (exposes the `release-cherry-pick` command, `main` in `package.json`)
- Module system: CommonJS (`require`/`module.exports`), async/await throughout
- GitLab access goes through the `glab` CLI (shelled out to via `child_process`) — the tool has no direct GitLab REST/token client. `glab` must be installed and on `PATH`; auth is `glab`'s own (`glab auth status`/`glab auth login`), not managed by this tool's config.

## Commands

- `release-cherry-pick release [-f <file> | -b <branches>]` → `runRelease()` in `src/workflow/release.js`. Resolves branches from a file, a CLI list, or interactively, then per branch: create release branch from staging → cherry-pick commits → (if `config.release.autoCreateMR`) push, select a reviewer, and create a GitLab MR via `glab`.
- `release-cherry-pick config [--init | --show]` → `setupWizard()` (Inquirer) or `loadConfig()`, both in `src/config/`.

## Architecture (`src/`)

- `cli/` — Commander program factory (`createProgram()`). Note: the actual commands are registered in `src/index.js`, not here — this module only sets name/description/version.
- `config/` — `defaults.js` (default config shape), `loader.js` (reads/writes `.release-cherry-pick.json` in `process.cwd()` of the *target* repo; `loadConfig()` deep-merges the file over the defaults so options missing from older files are always present, then runs `validateConfig` — pass `{ validate: false }` to skip, as the wizard does so it can repair a broken file), `setup.js` (Inquirer wizard: asks every option incl. `release.*`; when `autoCreateMR` is on it lists real project members via `glab` to pick `defaultReviewers`/`defaultAssignees`, falling back to typed usernames if glab is unavailable), `validator.js` (`validateConfig`: type-checks the full merged config and throws one `ConfigError` listing every problem).
- `git/` — `branch-parser.js` (parses `*TASK-ID*: description` lines — no branch-name field), `branch-selector.js` (`getRemoteBranches` fetches then lists `feature/*`/`hotfix/*` remote branches; `resolveBranchNameForTaskId(taskId, branches?)` finds the real remote branch(es) matching a task ID, used by the `--file` input path instead of guessing a name), `release-branch.js` (`buildReleaseBranchName`/`createReleaseBranch`/`pushBranch` — creates `release/<original-branch-name-with-known-prefix-stripped>` off staging; if the release branch already exists remotely it does **not** auto-offer to delete/overwrite it — that's a destructive op on a shared branch — it just reports failure and leaves it for the user to resolve manually), `cherry-pick.js` (cherry-pick via `git.raw(['cherry-pick', ...])`; see "Commit selection" below), `release-status.js` (`ReleaseStatus` class — tracks per-branch `PROCEDE` / `NO PROCEDE` / `CONFLICT` / `SKIPPED` outcomes).
- `glab/client.js` — wraps the `glab` CLI (`child_process.execFile`/`spawn`, no shell interpolation): `isGlabInstalled`, `checkAuthStatus`, `login` (interactive, inherited stdio), `ensureAuthenticated` (preflight used by `runRelease`), `getProjectMembers` (`glab api projects/:id/members/all`), `createMergeRequest` (`glab mr create ...`).
- `gitlab/` — `mr-creator.js` (orchestrates: fallback title/description from `config.release.mrTitleFormat` + commit list, tries AI content, then calls `glab.createMergeRequest` with squash/remove-source-branch flags and `config.release.defaultAssignees` as `--assignee`), `ai-description.js` (real Anthropic integration — see below), `reviewer-selector.js` (Inquirer checkbox over project members, pre-checking `config.release.defaultReviewers`, or legacy `defaultReviewerPattern` matches if that list is empty).
- `doc/` — `agents-generator.js` / `rpd-generator.js`: write `AGENTS.md` / `RPD.md` into the **target** project's root (prompt before overwrite).
- `report/` — `summary.js`: console + markdown release summaries (`PROCEDE`/`NO PROCEDE`/`CONFLICT`/`SKIPPED` status).
- `workflow/release.js` — the main orchestrator (`runRelease`) tying config, `glab` auth preflight, branch resolution, cherry-picking, reviewer selection, MR creation, and reporting together.
- `utils/` — `errors.js` (`AppError` base, subclassed by `ConfigError`/`GitError`/`GitLabError`), `logger.js` (chalk-based colored logger: `info/warn/error/success/header/table`).

## Commit selection for cherry-pick (important, found via real-world testing)

`getCommitsToCherryPick(sourceBranch, taskId, baseBranch)` in `src/git/cherry-pick.js` does **not** diff `sourceBranch` against `baseBranch` as a plain range. That was the original approach and it breaks in practice: real branches are often cut from a much older/different base than current `staging` (e.g. `develop` synced only periodically), so `staging..branch` can pull in hundreds of unrelated commits, or (if the branch's work already landed elsewhere) `develop..branch` can show zero commits even though the fix is genuinely still missing from `staging`. Verified against a real PROBROKER branch: `staging..hotfix/PB-I3245-...` returned 606 unrelated commits.

Instead it matches commits by the team's own `"[TASK-ID] description"` commit message convention (used consistently — 234/13687 commits in one real repo), restricted to commits not already reachable from `baseBranch`: `git log origin/<branch> --grep='^\[TASK-ID\]' --extended-regexp --regexp-ignore-case --not origin/<baseBranch> --reverse`. This reliably isolates just this task's own commit(s) regardless of the branch's real topology. `runRelease` passes `branchInfo.taskId` as the match key.

A cherry-pick can also come back **empty** (git: "The previous cherry-pick is now empty...") when the commit's net change is already present in the target tree (e.g. the same fix landed a different way) — this is not a real conflict, even though git's own message contains the word "conflict" in passing. `cherry-pick.js` distinguishes this from a real conflict by checking `git status().conflicted` — if there are no actually-conflicted files, it treats it as already-applied, runs `git cherry-pick --skip`, and keeps going (does not abort the branch). `runRelease` checks `cherryPickResult.commitsCherryPicked === 0` after a "success" and marks the branch `SKIPPED` (no push, no MR — nothing to release) rather than `PROCEDE`.

## AI-generated MR content

`src/gitlab/ai-description.js` calls the Anthropic Messages API (`@anthropic-ai/sdk`) to draft the MR title and description from the branch's commits, gated on `config.ai.enabled`. API key resolves from `config.ai.apiKey`, falling back to the `ANTHROPIC_API_KEY` env var. Default model: `config.ai.model` (default `claude-haiku-4-5-20251001`). On any failure (disabled, no key, API error, bad JSON) it returns `null` and `mr-creator.js` falls back to the static `config.release.mrTitleFormat` + commit-list template.

## Conventions

- Always log via `src/utils/logger.js`, not raw `console.log` (a couple of `console.log(JSON.stringify(...))` calls exist only for `config --show`).
- Errors: throw the appropriate `AppError` subclass; top-level handlers in `src/index.js` catch, log `error.message`, and `process.exit(1)`.
- Config is plaintext JSON in the target repo (`.release-cherry-pick.json`) — no `gitlab.token`/`gitlab.url`/`gitlab.projectId` exist anymore (glab owns GitLab auth and resolves the project from the git remote); only an optional `gitlab.host` remains for self-managed GitLab instances.
- Branch naming: original branches are `feature/*`/`hotfix/*`; release branches are `release/<original-name-with-known-prefix-stripped>` (e.g. `feature/PB-123-list-user` → `release/PB-123-list-user`) via `buildReleaseBranchName` in `src/git/release-branch.js`. Prefixes configurable via `git.branchPrefix` and honored everywhere: the release prefix names the release branch, and every non-release prefix (`getSourcePrefixes` in `src/git/branch-selector.js`, falling back to the defaults if none configured) defines which remote branches are listed/matched by task ID. Staging branch defaults to `staging`.
- Task IDs: uppercase alphanumeric with hyphen, e.g. `PB-I3217` (regex in `src/git/branch-parser.js`).
- MR titles: `config.release.mrTitleFormat` (default `[{taskId}] {description}`), used as the fallback when AI generation is off/fails; AI-generated titles are instructed to keep the `[{taskId}] ` prefix.
- MR options: `config.release.mrSquash` / `config.release.mrRemoveSourceBranch` both default `true` (GitLab's squash + delete-source-branch checkboxes), passed to `glab mr create`.
- Reviewers/assignees: `config.release.defaultReviewers` / `defaultAssignees` are lists of GitLab usernames picked in the wizard from real project members (`glab.getProjectMembers()`). Default reviewers are preselected in the per-branch reviewer prompt (still editable per MR); default assignees are passed to every MR automatically, with no prompt. Legacy `release.defaultReviewerPattern` (regex) is no longer a default but is still honored when present and `defaultReviewers` is empty; running the wizard migrates it into the list.
- Domain terminology is Spanish-influenced (`PROCEDE`/`NO PROCEDE`/`CONFLICT`/`SKIPPED` status, `'es-ES'` locale in generated `RPD.md`), reflecting the team's locale.
- `simple-git@3.36.0` has **no `cherryPick()` method** — cherry-pick operations must go through `git.raw(['cherry-pick', ...])`, not a hypothetical `git.cherryPick(...)`.

## Build / test

- `npm start` — runs the CLI (`node src/index.js`).
- `npm test` — placeholder only (`echo "Tests not yet implemented"`), not a real test runner.
- `node test-e2e.js` — manual smoke script (no assertions) exercising branch parsing, config defaults, `ReleaseStatus`, markdown summary, and doc generation. Not wired to `npm test`.
- `npm run sandbox:create` / `npm run sandbox:run -- [-b <list> | -f tasks.txt]` — synthetic disposable sandbox (`scripts/sandbox/`): a local bare `origin` + clone in `$TMPDIR/release-cherry-pick-sandbox` with branches covering each scenario (normal, untagged commit, conflict, already-applied → `SKIPPED`, duplicate task ID, no task ID), config `autoCreateMR: false` (no push/glab). `run-release.js` auto-answers Inquirer prompts; `npm run sandbox:config` runs the setup wizard the same way. Shared `harness.js` flags: `--fake-glab` (intercepts `child_process.execFile('glab', ...)` so the real `src/glab/client.js` runs against a fake — fixed members, `mr create` prints its args) and `--answer name=value` (force a prompt's answer). Use this to validate git-flow changes before touching any real repo.
- `npm run lint` / `npm run lint:fix` — ESLint (flat config, `eslint.config.js`, `eslint:recommended` + CommonJS/Node globals). A Husky `pre-commit` hook (`.husky/pre-commit`) runs `lint-staged` (`*.js` → `eslint --fix`) automatically on every commit, only against staged files. No Prettier config present (despite AGENTS.md-generated output claiming ESLint conventions for target projects — that doc is about *target* projects, not this repo).
- `glab` CLI flags used in `src/glab/client.js` (`--squash-before-merge`, `--remove-source-branch`, `--reviewer`, `--assignee`, `--no-editor`, `glab api projects/:id/members/all`) are based on documented `glab` behavior but were not live-verified in this environment (local `glab` install hits a snap-confinement permission error unrelated to this codebase). Re-verify with `glab mr create --help` / `glab api --help` on a working machine if MR creation misbehaves.
- The branch-creation, commit-selection, and empty-cherry-pick logic (everything in "Commit selection for cherry-pick" above) *was* validated against real data: a disposable local mirror clone of an actual production repo (PROBROKER, `gitlab.ingeniuscuba.com`), never pushed to or otherwise touching the real remote. `glab mr create`/reviewer-listing/AI generation were not exercised this way (no real GitLab MR was created, no Anthropic key configured).

## Other tooling in this repo

`openspec/` holds spec-driven planning artifacts (proposal/design/tasks docs) used to plan this project's own features — not part of the CLI's runtime behavior. `.agents/`, `.kilocode/`, `.kimi-code/`, `.opencode/` contain mirrored `openspec-*` workflow skills for various AI coding tools, plus one generic (non-project-specific) `nodejs-backend-patterns` skill.
