'use strict';

// Runs the setup wizard (config --init) against the sandbox, answering every prompt with its
// default unless forced with --answer. See harness.js for common flags.
// Usage:
//   node scripts/sandbox/run-config.js --fake-glab --answer autoCreateMR=true
//   node scripts/sandbox/run-config.js --answer autoCreateMR=true      (no glab -> manual usernames)

const fs = require('fs');
const { setup } = require('./harness');

const harness = setup(process.argv.slice(2), { confirmDefault: 'default' });

harness.require('src/config/setup')
  .setupWizard()
  .then((config) => {
    if (config) {
      console.log('\n--- saved .release-cherry-pick.json ---');
      console.log(fs.readFileSync('.release-cherry-pick.json', 'utf8'));
    }
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
