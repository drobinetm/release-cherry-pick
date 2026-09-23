<div align="center">

# release-cherry-pick

**Automates release cherry-picking and GitLab merge-request creation from the command line.**

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitLab API](https://img.shields.io/badge/GitLab-REST%20API%20%2B%20PAT-FC6D26?logo=gitlab&logoColor=white)](https://docs.gitlab.com/api/rest/)
[![AI](https://img.shields.io/badge/AI-Anthropic%20Claude-D97757)](https://docs.anthropic.com)
[![CLI](https://img.shields.io/badge/type-CLI-informational)](#)

</div>

## What it does

Shipping a release by hand — creating a release branch, cherry-picking each fix onto it, writing an MR title/description, picking a reviewer, checking the right MR checkboxes — is repetitive and error-prone, especially when releasing several unrelated tasks at once. `release-cherry-pick` is run **from inside the project being released** and automates that whole sequence for a list of tasks.

## What it solves

Given a list of task IDs (from a file, a `-b` flag, or interactive branch selection), for each one it:

1. **Creates a release branch off `staging`**, named after the original branch (prefix stripped): `feature/PB-123-list-user` → `release/PB-123-list-user`.
2. **Authenticates to GitLab** with a personal access token (`gitlab.token` in config, or the `GITLAB_TOKEN` env var), prompting for one if missing and validating it against `GET /user`.
3. **Cherry-picks only that task's own commits** onto the release branch — matched by the team's `[TASK-ID] description` commit message convention (not a naive branch diff, which breaks when a branch wasn't cut from a recent `staging`).
4. **Drafts the MR title and description with Anthropic Claude** from the picked commits, falling back to a static template if AI is disabled or fails.
5. **Lists real GitLab project members** for the reviewer prompt, pre-selecting your configured default reviewers.
6. **Creates the MR** with squash-commits and delete-source-branch checked by default, assigned to your configured default assignees.
7. **Never auto-resolves problems for you**: if cherry-picking conflicts, or the release branch already exists remotely, it stops touching that branch immediately and reports it — you decide manually. Branches whose changes are already present get reported as `SKIPPED`, not silently pushed.
8. **Produces a final report** (console + `release-summary.md`) showing exactly which branches shipped, which need manual conflict resolution, which were skipped, and the MR link for each.

## Requirements

- Node.js >= 18
- A GitLab personal access token with the `api` scope (set as `gitlab.token` in config, or export `GITLAB_TOKEN`)
- Run from inside the git repository you're releasing (it needs an `origin` remote pointing at GitLab)
- (Optional) an Anthropic API key, for AI-generated MR titles/descriptions

## Installation

```bash
npm install
```

## Usage

### Run a release

```bash
# Interactive — pick branches from the repo
node src/index.js release

# From a branch-list file
node src/index.js release --file branches.txt

# Direct — comma-separated task IDs and/or full branch names
node src/index.js release --branches PB-123,PB-124
node src/index.js release --branches feature/PB-123-list-user,hotfix/PB-124-fix-favicon
```

A bare task ID is resolved to its real remote branch (same as the file input); for a full branch name, the task ID is extracted from it. Branches whose name doesn't start with a task ID are skipped with a warning.

### Configure

```bash
# Initialize/update configuration
node src/index.js config --init

# Show current configuration
node src/index.js config --show
```

### Branch list file format

```
*PB-I3217*: Al gestionar autos de una póliza y al renovar una póliza de auto, el campo Endoso no está listando los posibles valores a seleccionar.
*PB-I3218*: Error al listar "Coberturas afectadas" (Configuraciones / Reclamos / Coberturas afectadas).
```

The tool resolves each task ID to its real remote branch automatically (asking you to disambiguate if more than one branch matches).

### Configuration file

Written to `.release-cherry-pick.json` in the project root you run the tool from. Since it can hold secrets (`gitlab.token`, `ai.apiKey`) and per-developer settings, every save also makes sure the project's `.gitignore` lists it (creating `.gitignore` if there isn't one) — commit that `.gitignore` change. If the config file was already committed, the tool warns you to untrack it with `git rm --cached .release-cherry-pick.json`.

```json
{
  "git": {
    "stagingBranch": "staging",
    "branchPrefix": {
      "feature": "feature/",
      "hotfix": "hotfix/",
      "release": "release/"
    }
  },
  "gitlab": {
    "host": "",
    "token": ""
  },
  "ai": {
    "enabled": true,
    "provider": "",
    "apiKey": "",
    "model": "",
    "baseURL": ""
  },
  "release": {
    "autoCreateMR": true,
    "mrTitleFormat": "[{taskId}] {description}",
    "defaultReviewers": [],
    "defaultAssignees": [],
    "mrSquash": true,
    "mrRemoveSourceBranch": true,
    "branches": []
  }
}
```

`ai.provider`/`ai.model` are empty by default: with AI enabled and no model saved, `release` asks you to pick a provider and model once and saves them. `ai.baseURL` is empty too, so each provider uses its own API endpoint unless you override it. `config --show` masks `gitlab.token` and `ai.apiKey` (e.g. `glpat-****WxYz`, `sk-ant-****9z8y`), and the wizard hides both while you type them.

Any option missing from the file is filled in from these defaults when it's loaded, so config files written by older versions keep working; the merged result is validated up front, and every problem (wrong type, invalid value) is reported in a single clear error.

`config --init` asks for every option above. When `autoCreateMR` is on, it uses the GitLab token (the one just entered, or `GITLAB_TOKEN`) to list the **real GitLab project members** so you pick `defaultReviewers` (preselected in each MR's reviewer prompt, still editable per MR) and `defaultAssignees` (assigned automatically to every MR) from them. If there's no token yet or the API call fails, it falls back to typing comma-separated usernames. Older configs with `release.defaultReviewerPattern` (a regex over usernames) still work — it's used when `defaultReviewers` is empty — and running the wizard migrates it into the explicit list.

GitLab authentication uses a personal access token stored in `gitlab.token` (or the `GITLAB_TOKEN` environment variable, which takes effect when the config value is empty). The GitLab host and project path are both resolved from the `origin` remote URL (SSH `git@host:group/proj.git`, `ssh://…`, or HTTPS, with or without credentials) — no `projectId` is stored. Set `gitlab.host` only when the remote's host isn't the GitLab web host, e.g. an SSH alias from `~/.ssh/config`. The Anthropic API key can also be supplied via the `ANTHROPIC_API_KEY` environment variable instead of the config file.

## Testing in development

There's no automated test suite yet (`npm test` is a placeholder). To validate a change:

1. **Run the smoke script**, which exercises branch parsing, config defaults, status tracking, and report/doc generation:
   ```bash
   node test-e2e.js
   ```
2. **Syntax-check everything** after editing:
   ```bash
   find src -name "*.js" -exec node --check {} \;
   ```
3. **Run the full release flow against the synthetic sandbox** — a throwaway local `origin` (bare repo) plus a clone with prepared branches covering each scenario (normal feature/hotfix, untagged commit that must not be picked, real conflict, already-applied change → `SKIPPED`, two branches with the same task ID, branch with no task ID). Its config has `autoCreateMR: false`, so nothing is pushed and the GitLab API is never called:
   ```bash
   npm run sandbox:create                                  # (re)creates it in $TMPDIR/release-cherry-pick-sandbox
   npm run sandbox:run -- -b "PB-100,hotfix/PB-I200-favicon,PB-300,PB-400,PB-500,feature/refactor"
   npm run sandbox:run -- -f tasks.txt                     # --file path (tasks.txt lives in the sandbox)
   npm run sandbox:run                                     # interactive-selection path
   ```
   `sandbox:run` auto-answers every prompt (list → first choice, checkbox → the checked choices or all if none are, confirm → no), so it runs unattended. Re-run `sandbox:create` before each run to start from a clean state.

   Two more flags work with both `sandbox:run` and `sandbox:config` (the setup wizard, whose prompts default to their current values):
   - `--fake-gitlab` intercepts `fetch()` calls to the GitLab REST API (`/user`, project members, `POST merge_requests` — which prints the request body it received and returns a fake URL) and sets a fake `GITLAB_TOKEN`, so the real client, member-selection and MR-creation code run end to end with no GitLab. Release branches are pushed to the sandbox's local `origin` only.
   - `--answer name=value` forces the answer of a prompt by name (value parsed as JSON when possible).
   ```bash
   npm run sandbox:config -- --fake-gitlab --answer autoCreateMR=true --answer 'defaultAssignees=["abel"]'
   npm run sandbox:run -- --fake-gitlab -b "PB-100,PB-300"   # shows the MR request body, incl. reviewer_ids/assignee_ids
   ```
4. **Exercise the real git flow against an isolated, disposable mirror** — never test branch creation, cherry-picking, or pushes directly against a real project. Clone a mirror of the target repo so pushes/branch deletes only touch your local disk:
   ```bash
   git clone --mirror <path-or-url-to-target-repo> /tmp/rcp-test/mirror.git
   git clone /tmp/rcp-test/mirror.git /tmp/rcp-test/work
   cd /tmp/rcp-test/work
   # run release-cherry-pick's functions/CLI here — origin points only at the local mirror
   ```
   This gives you real branches, real commit history, and real conflict scenarios with zero risk to the actual GitLab project.
5. **GitLab API behavior** (token validation, listing reviewers, MR creation) and **AI generation** need a real token (PAT with `api` scope) and a real Anthropic key respectively to exercise end-to-end — verify these manually against a test GitLab project before relying on them in production.

## Developers

- lleraabi@gmail.com
- ariel@ingeniuscuba.com
- drobinetm@outlook.com

## License

MIT
