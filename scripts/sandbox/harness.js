'use strict';

// Shared setup for the sandbox runners: parses the common flags, chdirs into the sandbox, makes
// every Inquirer prompt answer itself and, with --fake-gitlab, replaces the GitLab REST API with a fake.
//
// Common flags:
//   --work <dir>           sandbox clone to run in (default: $TMPDIR/release-cherry-pick-sandbox/work)
//   --answer name=value    force the answer of the prompt named `name` (repeatable); value is parsed
//                          as JSON when possible, e.g. --answer autoCreateMR=true --answer 'x=["a"]'
//   --fake-gitlab          intercept fetch() calls to <host>/api/v4 (GET /user, project members, POST
//                          merge_requests — which prints the request body and returns a fake URL), so
//                          the real src/gitlab/client.js runs with no GitLab; sets a fake GITLAB_TOKEN
//
// Auto-answers (when not forced): list/searchable list -> its default if any, else the first choice;
// checkbox -> the checked choices (or all if none are checked); input -> its default; confirm ->
// `confirmDefault` (see setup()).

const os = require('os');
const path = require('path');

const TOOL_DIR = path.resolve(__dirname, '..', '..');

const FAKE_MEMBERS = [
  { id: 1, username: 'cheiner', name: 'Cheiner Reviewer' },
  { id: 2, username: 'abel', name: 'Abel Developer' },
  { id: 3, username: 'ariel', name: 'Ariel Developer' },
  { id: 4, username: 'drobinet', name: 'D. Robinet' }
];

function parseArgs(argv) {
  const options = { workDir: path.join(os.tmpdir(), 'release-cherry-pick-sandbox', 'work'), answers: {}, fakeGitlab: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--work') options.workDir = path.resolve(argv[++i]);
    else if (arg === '--fake-gitlab') options.fakeGitlab = true;
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

function installFakeGitlab() {
  const realFetch = globalThis.fetch;
  if (!process.env.GITLAB_TOKEN) {
    process.env.GITLAB_TOKEN = 'fake-sandbox-token';
  }

  globalThis.fetch = async (url, init = {}) => {
    const { pathname } = new URL(url);
    if (!pathname.startsWith('/api/v4/')) {
      return realFetch(url, init);
    }
    const method = init.method || 'GET';
    const json = (status, body) => new globalThis.Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (method === 'GET' && pathname === '/api/v4/user') return json(200, { id: 2, username: 'abel' });
    if (method === 'GET' && /\/members\/all$/.test(pathname)) return json(200, FAKE_MEMBERS);
    if (method === 'POST' && /\/merge_requests$/.test(pathname)) {
      const body = JSON.parse(init.body);
      console.log(`  [fake-gitlab] POST ${pathname} ${JSON.stringify({ ...body, description: `(${body.description.length} chars)` })}`);
      return json(201, { web_url: `https://gitlab.example.com/group/project/-/merge_requests/1?source=${body.source_branch}` });
    }
    return json(404, { message: `fake gitlab: unsupported ${method} ${pathname}` });
  };
}

function choiceValue(choice) {
  return typeof choice === 'string' ? choice : choice.value;
}

function setup(argv, { confirmDefault }) {
  const options = parseArgs(argv);

  // simple-git captures the cwd when its modules load, so chdir before requiring the tool
  process.chdir(options.workDir);

  if (options.fakeGitlab) {
    installFakeGitlab();
  }

  const inquirer = require(path.join(TOOL_DIR, 'node_modules', 'inquirer'));
  inquirer.prompt = async (questions, previous = {}) => {
    const answers = { ...previous };
    for (const q of [].concat(questions)) {
      if (typeof q.when === 'function' && !q.when(answers)) continue;

      // Searchable prompts (autocomplete / checkbox-plus) provide their choices through source()
      const choices = typeof q.source === 'function' ? await q.source(answers, '') : q.choices;

      let value;
      if (q.name in options.answers) value = options.answers[q.name];
      else if (q.type === 'list' || q.type === 'autocomplete') {
        const values = choices.map(choiceValue);
        value = q.default !== undefined && values.includes(q.default) ? q.default : values[0];
      } else if (q.type === 'checkbox' || q.type === 'checkbox-plus') {
        const checked = choices.filter(c => c.checked);
        value = (checked.length > 0 ? checked : choices).map(choiceValue);
      } else if (q.type === 'confirm') value = confirmDefault === 'default' ? q.default : confirmDefault;
      else value = q.default;

      console.log(`  [auto-answer] ${q.message} -> ${JSON.stringify(value)}`);
      answers[q.name] = value;
    }
    return answers;
  };
  // src/utils/prompts.js registers custom prompt types (autocomplete, checkbox-plus); since every
  // prompt is answered above, registering is a no-op here.
  inquirer.registerPrompt = () => {};
  inquirer.prompt.registerPrompt = () => {};

  return { ...options, require: (relative) => require(path.join(TOOL_DIR, relative)) };
}

module.exports = { setup, FAKE_MEMBERS };
