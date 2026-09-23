# CLAUDE.md

This file gives Claude Code context on the `release-cherry-pick` repository.

## Project overview

`release-cherry-pick` is a Node.js CLI (built on Commander) that automates release cherry-picking and GitLab merge-request creation. It's designed to be installed/run as an **external tool from inside another git repo** (the "target" project being released) — this repo is the tool itself, not a project that gets released.

- Entry point / bin: `src/index.js` (exposes the `release-cherry-pick` command, `main` in `package.json`)
- Module system: CommonJS (`require`/`module.exports`), async/await throughout
- GitLab access is a direct REST client (`src/gitlab/client.js`, native `fetch`) authenticated with a Personal Access Token (scope `api`): `gitlab.token` in config, falling back to the `GITLAB_TOKEN` env var. The project is resolved from the `origin` remote URL. No `glab` dependency.

## Commands

- `release-cherry-pick release [-f <file> | -b <branches>]` → `runRelease()` in `src/workflow/release.js`. Resolves branches from a file, a CLI list, or interactively, then per branch: create release branch from staging → cherry-pick commits → (if `config.release.autoCreateMR`) push, select a reviewer, and create a GitLab MR via the REST API.
- `release-cherry-pick config [--init | --show]` → `setupWizard()` (Inquirer) or `loadConfig()`, both in `src/config/`.

## Architecture (`src/`)

- `cli/` — Commander program factory (`createProgram()`). Note: the actual commands are registered in `src/index.js`, not here — this module only sets name/description/version.
- `config/` — `defaults.js` (default config shape), `loader.js` (reads/writes `.release-cherry-pick.json` in `process.cwd()` of the *target* repo; `loadConfig()` deep-merges the file over the defaults so options missing from older files are always present, then runs `validateConfig` — pass `{ validate: false }` to skip, as the wizard does so it can repair a broken file), `setup.js` (Inquirer wizard: asks every option incl. `release.*`; when `autoCreateMR` is on it lists real project members via the REST client to pick `defaultReviewers`/`defaultAssignees`, falling back to typed usernames if there's no token or the call fails — it deliberately doesn't call `ensureAuthenticated`, which prompts for a token and saves the config mid-wizard, bypassing the review/cancel step), `validator.js` (`validateConfig`: type-checks the full merged config and throws one `ConfigError` listing every problem).
- `git/` — `branch-parser.js` (parses `*TASK-ID*: description` lines — no branch-name field), `branch-selector.js` (`getRemoteBranches` fetches then lists `feature/*`/`hotfix/*` remote branches; `resolveBranchNameForTaskId(taskId, branches?)` finds the real remote branch(es) matching a task ID, used by the `--file` input path instead of guessing a name), `release-branch.js` (`buildReleaseBranchName`/`createReleaseBranch`/`pushBranch` — creates `release/<original-branch-name-with-known-prefix-stripped>` off staging; if the release branch already exists remotely it does **not** auto-offer to delete/overwrite it — that's a destructive op on a shared branch — it just reports failure and leaves it for the user to resolve manually), `cherry-pick.js` (cherry-pick via `git.raw(['cherry-pick', ...])`; see "Commit selection" below), `release-status.js` (`ReleaseStatus` class — tracks per-branch `PROCEDE` / `NO PROCEDE` / `CONFLICT` / `SKIPPED` outcomes).
- `gitlab/client.js` — REST client (native `fetch`, no shelling out): `ensureAuthenticated` (resolves PAT from `gitlab.token`/`GITLAB_TOKEN` or prompts interactively, validates via `GET /user`), `getProjectMembers` (`GET /projects/:id/members/all` with pagination), `createMergeRequest` (`POST /projects/:id/merge_requests`, maps reviewer usernames → `reviewer_ids`). Project path is derived from the `origin` remote URL.
- `gitlab/` — `client.js` (REST API as above), `mr-creator.js` (orchestrates: fallback title/description from `config.release.mrTitleFormat` + commit list, tries AI content, then calls `gitlab.createMergeRequest` with squash/remove-source-branch flags and `config.release.defaultAssignees`, which the client maps from usernames to `assignee_ids` like reviewers → `reviewer_ids`), `ai-description.js` (real Anthropic integration — see below), `reviewer-selector.js` (Inquirer checkbox over project members, pre-checking `config.release.defaultReviewers`, or legacy `defaultReviewerPattern` matches if that list is empty).
- `doc/` — `agents-generator.js` / `rpd-generator.js`: write `AGENTS.md` / `RPD.md` into the **target** project's root (prompt before overwrite).
- `report/` — `summary.js`: console + markdown release summaries (`PROCEDE`/`NO PROCEDE`/`CONFLICT`/`SKIPPED` status).
- `workflow/release.js` — the main orchestrator (`runRelease`) tying config, GitLab token preflight, branch resolution, cherry-picking, reviewer selection, MR creation, and reporting together.
- `utils/` — `errors.js` (`AppError` base, subclassed by `ConfigError`/`GitError`/`GitLabError`), `logger.js` (chalk-based colored logger: `info/warn/error/success/header/table`).

## Commit selection for cherry-pick (important, found via real-world testing)

`getCommitsToCherryPick(sourceBranch, taskId, baseBranch)` in `src/git/cherry-pick.js` does **not** diff `sourceBranch` against `baseBranch` as a plain range. That was the original approach and it breaks in practice: real branches are often cut from a much older/different base than current `staging` (e.g. `develop` synced only periodically), so `staging..branch` can pull in hundreds of unrelated commits, or (if the branch's work already landed elsewhere) `develop..branch` can show zero commits even though the fix is genuinely still missing from `staging`. Verified against a real PROBROKER branch: `staging..hotfix/PB-I3245-...` returned 606 unrelated commits.

Instead it matches commits by the team's own `"[TASK-ID] description"` commit message convention (used consistently — 234/13687 commits in one real repo), restricted to commits not already reachable from `baseBranch`: `git log origin/<branch> --grep='^\[TASK-ID\]' --extended-regexp --regexp-ignore-case --not origin/<baseBranch> --reverse`. This reliably isolates just this task's own commit(s) regardless of the branch's real topology. `runRelease` passes `branchInfo.taskId` as the match key.

A cherry-pick can also come back **empty** (git: "The previous cherry-pick is now empty...") when the commit's net change is already present in the target tree (e.g. the same fix landed a different way) — this is not a real conflict, even though git's own message contains the word "conflict" in passing. `cherry-pick.js` distinguishes this from a real conflict by checking `git status().conflicted` — if there are no actually-conflicted files, it treats it as already-applied, runs `git cherry-pick --skip`, and keeps going (does not abort the branch). `runRelease` checks `cherryPickResult.commitsCherryPicked === 0` after a "success" and marks the branch `SKIPPED` (no push, no MR — nothing to release) rather than `PROCEDE`.

## AI-generated MR content

`src/gitlab/ai-description.js` calls the Anthropic Messages API (`@anthropic-ai/sdk`) to draft the MR title and description from the branch's commits, gated on `config.ai.enabled`. API key resolves from `config.ai.apiKey`, falling back to the `ANTHROPIC_API_KEY` env var. Default model: `config.ai.model` (default `claude-haiku-4-5-20251001`). On any failure (disabled, no key, API error, bad JSON) it returns `null` and `mr-creator.js` falls back to the static `config.release.mrTitleFormat` + commit-list template.

## Conventions

- Always log via `src/utils/logger.js`, not raw `console.log` (a couple of `console.log(JSON.stringify(...))` calls exist only for `config --show`, which prints a copy with `gitlab.token` masked via `maskSecret` in `src/utils/secrets.js`).
- AI defaults: `ai.provider`/`ai.model`/`ai.baseURL` default to `''` on purpose — `ensureAiSettings` (in `setup.js`) prompts for provider/model at release time when AI is enabled and they're missing, and an empty `baseURL` lets `resolveBaseURL` pick each provider's own endpoint (a non-empty `config.ai.baseURL` wins for *any* provider).
- Errors: throw the appropriate `AppError` subclass; top-level handlers in `src/index.js` catch, log `error.message`, and `process.exit(1)`.
- Config is plaintext JSON in the target repo (`.release-cherry-pick.json`) — `gitlab.token` (PAT with `api` scope; can also come from `GITLAB_TOKEN` env) and optional `gitlab.host` for self-managed GitLab; project id is resolved from the `origin` remote, not stored.
- Branch naming: original branches are `feature/*`/`hotfix/*`; release branches are `release/<original-name-with-known-prefix-stripped>` (e.g. `feature/PB-123-list-user` → `release/PB-123-list-user`) via `buildReleaseBranchName` in `src/git/release-branch.js`. Prefixes configurable via `git.branchPrefix` and honored everywhere: the release prefix names the release branch, and every non-release prefix (`getSourcePrefixes` in `src/git/branch-selector.js`, falling back to the defaults if none configured) defines which remote branches are listed/matched by task ID. Staging branch defaults to `staging`.
- Task IDs: uppercase alphanumeric with hyphen, e.g. `PB-I3217` (regex in `src/git/branch-parser.js`).
- MR titles: `config.release.mrTitleFormat` (default `[{taskId}] {description}`), used as the fallback when AI generation is off/fails; AI-generated titles are instructed to keep the `[{taskId}] ` prefix.
- MR options: `config.release.mrSquash` / `config.release.mrRemoveSourceBranch` both default `true` (GitLab's squash + delete-source-branch checkboxes), sent as `squash` / `remove_source_branch` on `POST /projects/:id/merge_requests`.
- Reviewer: `config.release.defaultReviewerPattern` (default `'^che(i|y)ner$'`) is matched case-insensitively against real project members (`gitlab.getProjectMembers()`) to preselect a default in the per-branch reviewer prompt; selected usernames are mapped to numeric `reviewer_ids` before the MR is created.
- Domain terminology is Spanish-influenced (`PROCEDE`/`NO PROCEDE`/`CONFLICT`/`SKIPPED` status, `'es-ES'` locale in generated `RPD.md`), reflecting the team's locale.
- `simple-git@3.36.0` has **no `cherryPick()` method** — cherry-pick operations must go through `git.raw(['cherry-pick', ...])`, not a hypothetical `git.cherryPick(...)`.

## Build / test

- `npm start` — runs the CLI (`node src/index.js`).
- `npm test` — placeholder only (`echo "Tests not yet implemented"`), not a real test runner.
- `node test-e2e.js` — manual smoke script (no assertions) exercising branch parsing, config defaults, `ReleaseStatus`, markdown summary, and doc generation. Not wired to `npm test`.
- `npm run sandbox:create` / `npm run sandbox:run -- [-b <list> | -f tasks.txt]` — synthetic disposable sandbox (`scripts/sandbox/`): a local bare `origin` + clone in `$TMPDIR/release-cherry-pick-sandbox` with branches covering each scenario (normal, untagged commit, conflict, already-applied → `SKIPPED`, duplicate task ID, no task ID), config `autoCreateMR: false` (no push/GitLab API). `run-release.js` auto-answers Inquirer prompts; `npm run sandbox:config` runs the setup wizard the same way. Shared `harness.js` flags: `--fake-gitlab` (intercepts `fetch()` to `/api/v4` and sets a fake `GITLAB_TOKEN`, so the real `src/gitlab/client.js` runs against a fake — fixed members, `POST merge_requests` prints its body) and auto-answers the searchable `autocomplete`/`checkbox-plus` prompts from `src/utils/prompts.js` too and `--answer name=value` (force a prompt's answer). Use this to validate git-flow changes before touching any real repo.
- `npm run lint` / `npm run lint:fix` — ESLint (flat config, `eslint.config.js`, `eslint:recommended` + CommonJS/Node globals). A Husky `pre-commit` hook (`.husky/pre-commit`) runs `lint-staged` (`*.js` → `eslint --fix`) automatically on every commit, only against staged files. No Prettier config present (despite AGENTS.md-generated output claiming ESLint conventions for target projects — that doc is about *target* projects, not this repo).
- The GitLab REST paths used in `src/gitlab/client.js` (`GET /user`, `GET /projects/:id/members/all`, `POST /projects/:id/merge_requests`, `PRIVATE-TOKEN` auth header, `reviewer_ids`) follow the public GitLab API docs but were **not** live-verified against a real instance from this environment (no token configured here). Re-verify with a test project if MR creation misbehaves.
- The branch-creation, commit-selection, and empty-cherry-pick logic (everything in "Commit selection for cherry-pick" above) *was* validated against real data: a disposable local mirror clone of an actual production repo (PROBROKER, `gitlab.ingeniuscuba.com`), never pushed to or otherwise touching the real remote. MR creation/reviewer-listing/AI generation were not exercised this way (no real GitLab MR was created, no Anthropic key configured).

## Other tooling in this repo

`openspec/` holds spec-driven planning artifacts (proposal/design/tasks docs) used to plan this project's own features — not part of the CLI's runtime behavior. `.agents/`, `.kilocode/`, `.kimi-code/`, `.opencode/` contain mirrored `openspec-*` workflow skills for various AI coding tools, plus one generic (non-project-specific) `nodejs-backend-patterns` skill.
