# Releasing

How to publish a new version of `release-cherry-pick` to npm. Publishing is automated: pushing a `v*` tag runs `.github/workflows/publish.yml`. Pushes to `main` never publish.

## One-time setup

1. On npmjs.com, open the `release-cherry-pick` package → Settings → Trusted Publisher → GitHub Actions.
2. Fill in owner `drobinetm`, repository `release-cherry-pick`, workflow `publish.yml`.
3. **Allowed actions:** tick **Allow `npm publish`**. With both boxes empty the publisher can only stage versions, and the workflow's `npm publish` fails with `E403 ... OIDC permission denied for this action`. `dist-tag` is not needed. The config shows "Pending validation" until the first successful publish.
4. Recommended: in GitHub, add a tag protection rule (or a ruleset) for `v*` so only maintainers can create release tags.

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
   - the Trusted Publisher is not configured, or "Allow `npm publish`" is not ticked (401/403 on `npm publish`).

   After a successful publish, the workflow also creates the GitHub Release for the tag, with auto-generated notes (it runs last, so a failed publish never leaves a release behind).

6. Verify the published package:

   ```bash
   npm view release-cherry-pick version
   npm run test:package -- --version <new-version>
   ```

   The npm page should show the "Provenance" badge, and the repo's Releases page should list `v<version>`.

## If something goes wrong

- **Tag pushed with the wrong version or the run failed before publishing:** nothing was published, so delete the tag and retry.

  ```bash
  git tag -d v<version>
  git push origin :refs/tags/v<version>
  ```

  Fix the problem, then run the checklist again.
- **Published, but the GitHub Release step failed:** the package is live, so do not retag. Create the release by hand: `gh release create v<version> --verify-tag --generate-notes`.
- **A bad version was published:** npm versions are immutable and cannot be republished. Release a fixed patch version. If the bad one is harmful, deprecate it: `npm deprecate release-cherry-pick@<version> "<reason>"`.
- **The README on npm looks stale:** the README is frozen per version, so a docs change needs a new release.

## Notes

- The tarball contains only `src/` (plus `README`, `LICENSE`, `package.json`) because of the `files` field in `package.json`. Do not widen it.
- Actions in the workflow are pinned to commit SHAs and npm to an exact version. Update them deliberately (check the new tag's SHA) rather than switching to floating tags.
