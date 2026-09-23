'use strict';

// Runs runRelease() against the sandbox created by make-sandbox.sh, answering every prompt itself
// (confirms default to "no", so no report/docs files are written). See harness.js for common flags.
// Usage:
//   node scripts/sandbox/run-release.js -b "PB-100,hotfix/PB-I200-favicon" [--work <dir>] [--fake-gitlab]
//   node scripts/sandbox/run-release.js -f tasks.txt
//   node scripts/sandbox/run-release.js                 (interactive branch selection path)

const { setup } = require('./harness');

const harness = setup(process.argv.slice(2), { confirmDefault: false });

const options = {};
for (let i = 0; i < harness.rest.length; i++) {
  const arg = harness.rest[i];
  if (arg === '-b' || arg === '--branches') options.branches = harness.rest[++i];
  else if (arg === '-f' || arg === '--file') options.file = harness.rest[++i];
}

harness.require('src/workflow/release')
  .runRelease(options)
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
