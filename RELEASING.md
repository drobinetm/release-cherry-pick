# Releasing

How to publish a new version of `release-cherry-pick` to npm. Publishing is automated: pushing a `v*` tag runs `.github/workflows/publish.yml`. Pushes to `main` never publish.

## One-time setup

1. On npmjs.com, open the `release-cherry-pick` package → Settings → Trusted Publisher → GitHub Actions.
2. Fill in owner `drobinetm`, repository `release-cherry-pick`, workflow `publish.yml`.
3. Recommended: in GitHub, add a tag protection rule (or a ruleset) for `v*` so only maintainers can create release tags.

No `NPM_TOKEN` is needed; the workflow authenticates with OIDC.

## Release checklist

1. Start from an up-to-date `main` with a clean working tree:

   ```bash
   git checkout main && git pull
   git status   # must be clean
   ```

2. Check that the code is releasable:

   ```bash
   npm run lint
   npm run sandbox:create && npm run sandbox:run   # optional: exercises the git flow
   ```

3. Pick the version bump ([semver](https://semver.org)):

   | Change | Command |
   | --- | --- |
   | Bug fix, docs, internal | `npm version patch` |
   | New backwards-compatible option or command | `npm version minor` |
   | Breaking change (flags, config format, behavior) | `npm version major` |

   `npm version` bumps `package.json` and `package-lock.json`, creates the commit `v<version>` and the tag `v<version>`.

4. Push the commit and the tag together:

   ```bash
   git push --follow-tags
   ```

5. Watch the run in GitHub → Actions → "Publish to npm". It fails, without publishing, if:
   - the tag does not match the `package.json` version,
   - lint fails,
   - the Trusted Publisher is not configured (401/403 on `npm publish`).

6. Verify the published package:

   ```bash
   npm view release-cherry-pick version
   npm run test:package -- --version <new-version>
   ```

   The npm page should show the "Provenance" badge.

## If something goes wrong

- **Tag pushed with the wrong version or the run failed before publishing:** nothing was published, so delete the tag and retry.

  ```bash
  git tag -d v<version>
  git push origin :refs/tags/v<version>
  ```

  Fix the problem, then run the checklist again.
- **A bad version was published:** npm versions are immutable and cannot be republished. Release a fixed patch version. If the bad one is harmful, deprecate it: `npm deprecate release-cherry-pick@<version> "<reason>"`.
- **The README on npm looks stale:** the README is frozen per version, so a docs change needs a new release.

## Notes

- The tarball contains only `src/` (plus `README`, `LICENSE`, `package.json`) because of the `files` field in `package.json`. Do not widen it.
- Actions in the workflow are pinned to commit SHAs and npm to an exact version. Update them deliberately (check the new tag's SHA) rather than switching to floating tags.
