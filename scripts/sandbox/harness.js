'use strict';

// Shared setup for the sandbox runners: parses the common flags, chdirs into the sandbox, makes
// every Inquirer prompt answer itself and, with --fake-glab, replaces the glab CLI with a fake.
//
// Common flags:
//   --work <dir>           sandbox clone to run in (default: $TMPDIR/release-cherry-pick-sandbox/work)
//   --answer name=value    force the answer of the prompt named `name` (repeatable); value is parsed
//                          as JSON when possible, e.g. --answer autoCreateMR=true --answer 'x=["a"]'
//   --fake-glab            fake `glab` (authenticated, a fixed member list, `mr create` logs its args
//                          and returns a fake URL) so MR/member flows run with no real GitLab
//
// Auto-answers (when not forced): list -> first choice, checkbox -> the checked choices (or all if
// none are checked), input -> its default, confirm -> `confirmDefault` (see setup()).

const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const TOOL_DIR = path.resolve(__dirname, '..', '..');

const FAKE_MEMBERS = [
  { id: 1, username: 'cheiner', name: 'Cheiner Reviewer' },
  { id: 2, username: 'abel', name: 'Abel Developer' },
  { id: 3, username: 'ariel', name: 'Ariel Developer' },
  { id: 4, username: 'drobinet', name: 'D. Robinet' }
];

function parseArgs(argv) {
  const options = { workDir: path.join(os.tmpdir(), 'release-cherry-pick-sandbox', 'work'), answers: {}, fakeGlab: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--work') options.workDir = path.resolve(argv[++i]);
    else if (arg === '--fake-glab') options.fakeGlab = true;
    else if (arg === '--answer') {
      const [name, ...value] = argv[++i].split('=');
      const raw = value.join('=');
      try {
        options.answers[name] = JSON.parse(raw);
      } catch {
        options.answers[name] = raw;
      }
    } else options.rest.push(arg);
  }
  return options;
}

function installFakeGlab() {
  const realExecFile = childProcess.execFile;
  childProcess.execFile = function (bin, args, opts, cb) {
    if (bin !== 'glab') {
      return realExecFile.apply(this, arguments);
    }
    const callback = typeof opts === 'function' ? opts : cb;
    const reply = (stdout) => process.nextTick(() => callback(null, stdout, ''));
    const command = args.slice(0, 2).join(' ');

    if (args[0] === 'version') return reply('glab 1.0.0 (fake)\n');
    if (command === 'auth status') return reply('Logged in to gitlab.example.com as abel (fake)\n');
    if (args[0] === 'api' && args[1] === 'projects/:id/members/all') return reply(JSON.stringify(FAKE_MEMBERS));
    if (command === 'mr create') {
      console.log(`  [fake-glab] glab ${args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
      const source = args[args.indexOf('--source-branch') + 1];
      return reply(`https://gitlab.example.com/group/project/-/merge_requests/new?source=${source}\n`);
    }
    return process.nextTick(() => callback(Object.assign(new Error(`fake glab: unsupported command ${args.join(' ')}`), { stdout: '', stderr: '' })));
  };
}

function setup(argv, { confirmDefault }) {
  const options = parseArgs(argv);

  // simple-git captures the cwd when its modules load, so chdir before requiring the tool
  process.chdir(options.workDir);

  if (options.fakeGlab) {
    // Must run before src/glab/client.js is required, since it destructures execFile at load time
    installFakeGlab();
  }

  const inquirer = require(path.join(TOOL_DIR, 'node_modules', 'inquirer'));
  inquirer.prompt = async (questions, previous = {}) => {
    const answers = { ...previous };
    for (const q of [].concat(questions)) {
      if (typeof q.when === 'function' && !q.when(answers)) continue;

      let value;
      if (q.name in options.answers) value = options.answers[q.name];
      else if (q.type === 'list') value = q.choices[0];
      else if (q.type === 'checkbox') {
        const checked = q.choices.filter(c => c.checked);
        value = (checked.length > 0 ? checked : q.choices).map(c => c.value);
      } else if (q.type === 'confirm') value = confirmDefault === 'default' ? q.default : confirmDefault;
      else value = q.default;

      console.log(`  [auto-answer] ${q.message} -> ${JSON.stringify(value)}`);
      answers[q.name] = value;
    }
    return answers;
  };

  return { ...options, require: (relative) => require(path.join(TOOL_DIR, relative)) };
}

module.exports = { setup, FAKE_MEMBERS };
