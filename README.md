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
5. **Lists real GitLab project members** for the reviewer prompt, pre-selecting whichever member matches your configured default reviewer pattern.
6. **Creates the MR** with squash-commits and delete-source-branch checked by default.
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

# Direct — comma-separated branch names
node src/index.js release --branches feature/PB-123-list-user,hotfix/PB-124-fix-favicon
```

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

Written to `.release-cherry-pick.json` in the project root you run the tool from:

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
    "enabled": false,
    "provider": "anthropic",
    "apiKey": "",
    "model": "claude-haiku-4-5-20251001",
    "baseURL": "https://api.anthropic.com/v1"
  },
  "release": {
    "autoCreateMR": true,
    "mrTitleFormat": "[{taskId}] {description}",
    "defaultAssignees": [],
    "mrSquash": true,
    "mrRemoveSourceBranch": true,
    "defaultReviewerPattern": "^che(i|y)ner$",
    "branches": []
  }
}
```

GitLab authentication uses a personal access token stored in `gitlab.token` (or the `GITLAB_TOKEN` environment variable, which takes effect when the config value is empty). `gitlab.host` is only needed for a self-managed instance (leave blank for gitlab.com). The project path is resolved from the `origin` remote URL — no `projectId` is stored. The Anthropic API key can also be supplied via the `ANTHROPIC_API_KEY` environment variable instead of the config file.

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
3. **Exercise the real git flow against an isolated, disposable mirror** — never test branch creation, cherry-picking, or pushes directly against a real project. Clone a mirror of the target repo so pushes/branch deletes only touch your local disk:
   ```bash
   git clone --mirror <path-or-url-to-target-repo> /tmp/rcp-test/mirror.git
   git clone /tmp/rcp-test/mirror.git /tmp/rcp-test/work
   cd /tmp/rcp-test/work
   # run release-cherry-pick's functions/CLI here — origin points only at the local mirror
   ```
   This gives you real branches, real commit history, and real conflict scenarios with zero risk to the actual GitLab project.
4. **GitLab API behavior** (token validation, listing reviewers, MR creation) and **AI generation** need a real token (PAT with `api` scope) and a real Anthropic key respectively to exercise end-to-end — verify these manually against a test GitLab project before relying on them in production.

## Developers

- lleraabi@gmail.com
- ariel@ingeniuscuba.com
- drobinetm@outlook.com

## License

MIT
