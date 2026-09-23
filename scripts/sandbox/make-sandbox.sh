#!/usr/bin/env bash
# Creates a disposable local sandbox to exercise release-cherry-pick without touching any real repo:
#   origin.git  bare repo that stands in for GitLab
#   work/       clone where the tool is run (config has autoCreateMR: false, so no glab/GitLab calls)
# Usage: bash scripts/sandbox/make-sandbox.sh [sandbox-dir]   (default: $TMPDIR/release-cherry-pick-sandbox)
set -e
ROOT="${1:-${TMPDIR:-/tmp}/release-cherry-pick-sandbox}"
rm -rf "$ROOT" && mkdir -p "$ROOT" && cd "$ROOT"

git init -q --bare -b main origin.git
git clone -q origin.git work 2>/dev/null
cd work
git config user.name "Sandbox"
git config user.email "sandbox@example.com"
git config core.autocrlf false

commit() { git add . && git commit -qm "$1"; }

echo "base" > app.txt && echo "a" > shared.txt
commit "init" && git branch -M staging && git push -q -u origin staging

# PB-100: normal case (2 tagged commits + 1 untagged one that must NOT be picked)
git checkout -qb feature/PB-100-list-user staging
echo "list user" > pb100.txt && commit "[PB-100] add list user"
echo "wip" > noise.txt && commit "untagged commit"
echo "list user v2" > pb100.txt && commit "[PB-100] fix list user"
git push -q -u origin feature/PB-100-list-user

# PB-I200: normal hotfix
git checkout -qb hotfix/PB-I200-favicon staging
echo "favicon" > favicon.txt && commit "[PB-I200] fix favicon"
git push -q -u origin hotfix/PB-I200-favicon

# PB-300: real conflict (touches shared.txt, which staging later changes differently)
git checkout -qb feature/PB-300-conflict staging
echo "b-from-feature" > shared.txt && commit "[PB-300] change shared"
git push -q -u origin feature/PB-300-conflict

# PB-400: already applied to staging another way (empty cherry-pick -> SKIPPED)
git checkout -qb feature/PB-400-already staging
echo "same fix" > pb400.txt && commit "[PB-400] same fix"
git push -q -u origin feature/PB-400-already

# PB-500: two branches with the same task ID (tool must ask which one)
git checkout -qb feature/PB-500-one staging
echo 1 > pb500.txt && commit "[PB-500] one" && git push -q -u origin feature/PB-500-one
git checkout -qb feature/PB-500-two staging
echo 2 > pb500.txt && commit "[PB-500] two" && git push -q -u origin feature/PB-500-two

# feature/refactor: no task ID in the name (tool must warn and skip it)
git checkout -qb feature/refactor staging
echo "refactor" > refactor.txt && commit "refactor something"
git push -q -u origin feature/refactor

# staging moves on: conflicts with PB-300 and already contains PB-400's change
git checkout -q staging
echo "b-from-staging" > shared.txt && echo "same fix" > pb400.txt
commit "staging moves on" && git push -q origin staging

cat > .release-cherry-pick.json <<'EOF'
{
  "git": { "stagingBranch": "staging", "branchPrefix": { "feature": "feature/", "hotfix": "hotfix/", "release": "release/" } },
  "gitlab": { "host": "" },
  "ai": { "enabled": false, "provider": "anthropic", "apiKey": "", "model": "claude-haiku-4-5-20251001" },
  "release": { "autoCreateMR": false, "mrTitleFormat": "[{taskId}] {description}", "defaultReviewers": [], "defaultAssignees": [], "mrSquash": true, "mrRemoveSourceBranch": true }
}
EOF

# Branch list file for the -f/--file input path
cat > tasks.txt <<'EOF'
*PB-100*: Listar usuarios
*PB-I200*: Favicon incorrecto
*PB-300*: Cambio con conflicto
*PB-400*: Fix ya aplicado
*PB-500*: Dos ramas con el mismo ID
EOF

# Keep the untracked sandbox files out of git status
printf '.release-cherry-pick.json\ntasks.txt\nrelease-summary.md\nAGENTS.md\nRPD.md\n' >> .git/info/exclude

echo "Sandbox ready: $(pwd)"
