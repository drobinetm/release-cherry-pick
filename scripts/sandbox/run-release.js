'use strict';

// Runs runRelease() against the sandbox created by make-sandbox.sh, auto-answering every Inquirer
// prompt so it runs unattended: list -> first choice, confirm -> false, anything else -> its default.
// Usage:
//   node scripts/sandbox/run-release.js -b "PB-100,hotfix/PB-I200-favicon" [--work <dir>]
//   node scripts/sandbox/run-release.js -f tasks.txt [--work <dir>]
//   node scripts/sandbox/run-release.js [--work <dir>]        (interactive branch selection path)

const os = require('os');
const path = require('path');

const TOOL_DIR = path.resolve(__dirname, '..', '..');

const options = {};
let workDir = path.join(os.tmpdir(), 'release-cherry-pick-sandbox', 'work');
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-b' || argv[i] === '--branches') options.branches = argv[++i];
  else if (argv[i] === '-f' || argv[i] === '--file') options.file = argv[++i];
  else if (argv[i] === '--work') workDir = path.resolve(argv[++i]);
}

// simple-git captures the cwd when its modules load, so chdir before requiring the tool
process.chdir(workDir);

const inquirer = require(path.join(TOOL_DIR, 'node_modules', 'inquirer'));
inquirer.prompt = async (questions) => {
  const answers = {};
  for (const q of [].concat(questions)) {
    let value;
    if (q.type === 'list') value = q.choices[0];
    else if (q.type === 'checkbox') value = q.choices.map(c => c.value);
    else if (q.type === 'confirm') value = false;
    else value = q.default;
    console.log(`  [auto-answer] ${q.message} -> ${JSON.stringify(value)}`);
    answers[q.name] = value;
  }
  return answers;
};

require(path.join(TOOL_DIR, 'src', 'workflow', 'release'))
  .runRelease(options)
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
