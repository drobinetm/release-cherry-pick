'use strict';

// End-to-end test of the *published* npm artifact (the registry tarball), not the local checkout:
//   Phase 1 SEGURIDAD   download the tarball, verify registry integrity, scan its contents for
//                       leaked files/secrets, install-time lifecycle scripts and license drift
//   Phase 2 INSTALACIÓN install it for real (lifecycle scripts enabled), exercise the bin and make
//                       sure `config --show` never touches the real ~/.release-cherry-pick, audit deps
//   Phase 3 CHERRY-PICK run the release flow against the mutated sandbox repo (conflict,
//                       already-applied, duplicate task ID, untagged commit, staging moved on) and
//                       assert the git state it leaves behind
//
// Usage:
//   node scripts/sandbox/test-package.js [--version 1.0.0] [--sandbox <dir>] [--keep]
//   npm run test:package

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PKG_NAME = 'release-cherry-pick';
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SANDBOX = fs.existsSync('/tmp/opencode')
  ? '/tmp/opencode/release-cherry-pick-package-test'
  : path.join(os.tmpdir(), 'release-cherry-pick-package-test');

const SECRET_PATTERNS = [
  ['GitLab PAT', /glpat-[A-Za-z0-9_-]{10,}/],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{10,}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Hardcoded secret', /["'](password|passwd|secret|api[_-]?key|token)["']\s*[:=]\s*["'][^"']{8,}["']/i]
];

const results = [];
function check(phase, name, ok, detail = '') {
  results.push({ phase, name, ok: Boolean(ok), detail });
  console.log(`  [${phase}] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function warn(phase, name, detail = '') {
  results.push({ phase, name: `WARN ${name}`, ok: true, detail });
  console.log(`  [${phase}] WARN ${name}${detail ? ` — ${detail}` : ''}`);
}
function note(phase, text) {
  console.log(`  [${phase}] ${text}`);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: opts.cwd || REPO_ROOT,
    env: { ...process.env, ...(opts.env || {}) },
    timeout: opts.timeout || 180000,
    maxBuffer: 32 * 1024 * 1024
  });
  if (res.error) throw res.error;
  return { code: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function homeConfigSnapshot() {
  const dir = path.join(os.homedir(), '.release-cherry-pick');
  if (!fs.existsSync(dir)) return { existed: false };
  const entries = fs.readdirSync(dir).sort().map((name) => {
    const stat = fs.statSync(path.join(dir, name));
    return `${name}:${stat.mtimeMs}`;
  });
  return { existed: true, entries: entries.join('|') };
}

// --------------------------------------------------------------------------- phase 1: seguridad

async function phaseSecurity(root, version) {
  const phase = '1-seguridad';
  const metaRes = await fetch(`https://registry.npmjs.org/${PKG_NAME}/${version}`);
  if (metaRes.status !== 200) {
    check(phase, `version ${version} exists in the registry`, false, `HTTP ${metaRes.status}`);
    return null;
  }
  const meta = await metaRes.json();
  check(phase, `version ${version} exists in the registry`, true, meta.dist.tarball);

  const tarballPath = path.join(root, `${PKG_NAME}-${version}.tgz`);
  const tarballRes = await fetch(meta.dist.tarball);
  const tarball = Buffer.from(await tarballRes.arrayBuffer());
  fs.writeFileSync(tarballPath, tarball);
  const digest = `sha512-${crypto.createHash('sha512').update(tarball).digest('base64')}`;
  check(phase, 'tarball matches registry dist.integrity', digest === meta.dist.integrity, digest.slice(0, 28) + '…');

  const extractDir = path.join(root, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });
  const extract = run('tar', ['-xzf', tarballPath, '-C', extractDir]);
  check(phase, 'tarball extracts cleanly', extract.code === 0, extract.out.trim());
  const pkgDir = path.join(extractDir, 'package');

  const entries = run('tar', ['-tzf', tarballPath]).out.trim().split('\n').filter(Boolean);
  check(phase, 'fileCount matches dist.fileCount', entries.length === meta.dist.fileCount,
    `${entries.length} vs ${meta.dist.fileCount}`);

  // Credentials / key material must never ship in a tarball
  const leaked = entries.filter((e) =>
    /(^|\/)(\.env(\..*)?|\.npmrc|\.netrc|\.gitconfig|id_rsa|id_ed25519|[^/]*\.(pem|key|p12|pfx|jks))$/i.test(e));
  check(phase, 'no credential/key files in the tarball', leaked.length === 0, leaked.join(', '));

  const dotEntries = entries.filter((e) => /(^|\/)\.[^/]/.test(e));
  const dangerousDots = dotEntries.filter((e) => /\.git\//.test(e) || /\.env/.test(e));
  check(phase, 'no .git/ or .env* entries in the tarball', dangerousDots.length === 0, dangerousDots.join(', '));
  if (dotEntries.length > 0 && dangerousDots.length === 0) warn(phase, 'dotfiles shipped', dotEntries.join(', '));

  const devEntries = entries.filter((e) => /^package\/(scripts|tests?|openspec|\.github)\//.test(e));
  if (devEntries.length > 0) warn(phase, 'dev/test files shipped', `${devEntries.length} files (scripts/, tests/, .github/)`);
  else note(phase, 'only runtime files shipped (src/, README, LICENSE, package.json)');

  const pub = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const installScripts = ['preinstall', 'install', 'postinstall'].filter((s) => pub.scripts && pub.scripts[s]);
  check(phase, 'no install-time lifecycle scripts (RCE surface)', installScripts.length === 0,
    installScripts.map((s) => `${s}: ${pub.scripts[s]}`).join(', '));
  if (pub.scripts && pub.scripts.prepare) {
    warn(phase, 'prepare script shipped', `"${pub.scripts.prepare}" — runs on git installs and on pack/publish, not on registry installs`);
  }
  check(phase, 'published license field is MIT', pub.license === 'MIT', String(pub.license));
  const licenseFile = fs.readFileSync(path.join(pkgDir, 'LICENSE'), 'utf8');
  check(phase, 'LICENSE file is MIT', licenseFile.trimStart().startsWith('MIT License'));

  const binRel = pub.bin && pub.bin[PKG_NAME];
  check(phase, 'bin entry points at an existing file with a shebang', Boolean(binRel) && fs.existsSync(path.join(pkgDir, binRel)) &&
    fs.readFileSync(path.join(pkgDir, binRel), 'utf8').startsWith('#!/usr/bin/env node'), String(binRel));

  // Every Inquirer prompt that collects a secret must be password-type with a mask (inquirer 8
  // ignores `mask` on plain input prompts, which would echo the secret in clear)
  const srcFiles = listFiles(path.join(pkgDir, 'src')).filter((f) => f.endsWith('.js'));
  const secretPrompts = [];
  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(/type: 'password'/g)) {
      const block = content.slice(match.index, match.index + 300);
      secretPrompts.push({ file: path.relative(pkgDir, file), masked: /mask: '\*'/.test(block) });
    }
  }
  check(phase, 'secret prompts are password-type with a mask',
    secretPrompts.length >= 3 && secretPrompts.every((p) => p.masked),
    secretPrompts.map((p) => `${p.file}:${p.masked ? 'masked' : 'NOT MASKED'}`).join(', '));

  // Secret scan over every shipped file. Matches that are clearly documentation placeholders
  // (maskSecret's own example, "your-token", "xxxx…") are not secrets.
  const PLACEHOLDER = /(x{4,}|example|placeholder|your[_-]?|AbCdEf|123456|<[^>]+>|\.\.\.)/i;
  const hits = [];
  for (const file of listFiles(pkgDir)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const [label, re] of SECRET_PATTERNS) {
      const match = content.match(re);
      if (match && !PLACEHOLDER.test(match[0])) {
        hits.push(`${path.relative(pkgDir, file)}: ${label} (${match[0].slice(0, 12)}…)`);
      }
    }
  }
  check(phase, 'no secrets hardcoded in shipped files', hits.length === 0, hits.join('; '));

  // npm requires an author/maintainer and a repository; nothing secret, but assert no stray env file
  check(phase, 'dependencies are declared (no bundled node_modules)', !entries.some((e) => e.includes('node_modules/')),
    entries.filter((e) => e.includes('node_modules/')).slice(0, 3).join(', '));

  return { meta, tarballPath, pkgDir, version };
}

// ------------------------------------------------------------------------ phase 2: instalación

function phaseInstall(root, tarballPath, version) {
  const phase = '2-instalación';
  const installDir = path.join(root, 'install');
  fs.mkdirSync(installDir, { recursive: true });

  const homeBefore = homeConfigSnapshot();
  const install = run('npm', ['install', '--prefix', installDir, '--no-fund', tarballPath], { cwd: root });
  check(phase, 'npm install <tarball> succeeds', install.code === 0, install.out.trim().split('\n').slice(-3).join(' | '));

  const lifecycle = install.out.split('\n').filter((l) => /^\s*>\s*(preinstall|install|postinstall|prepare)\b/.test(l));
  check(phase, 'no lifecycle script output during install', lifecycle.length === 0, lifecycle.join(' | '));

  const bin = path.join(installDir, 'node_modules', '.bin', PKG_NAME);
  check(phase, 'bin shim created', fs.existsSync(bin));

  const ver = run(bin, ['--version'], { cwd: root });
  check(phase, 'CLI --version reports the published version', ver.code === 0 && ver.out.trim() === version, ver.out.trim());

  const help = run(bin, ['--help'], { cwd: root });
  check(phase, 'CLI --help lists release and config', help.code === 0 && /release/.test(help.out) && /config/.test(help.out),
    help.out.split('\n').filter((l) => /^\s+\w/.test(l)).slice(0, 4).join(' | '));

  const configDir = path.join(root, 'config');
  const cfg = run(bin, ['config', '--show'], { cwd: root, env: { RELEASE_CHERRY_PICK_CONFIG_DIR: configDir } });
  check(phase, 'config --show runs with a sandboxed config dir', cfg.code === 0 && /No configuration found/.test(cfg.out),
    cfg.out.trim().split('\n')[0]);

  const homeAfter = homeConfigSnapshot();
  check(phase, 'real ~/.release-cherry-pick untouched', JSON.stringify(homeBefore) === JSON.stringify(homeAfter),
    homeBefore.existed ? 'entries unchanged' : 'directory not created');

  const audit = run('npm', ['audit', '--prefix', installDir, '--json'], { cwd: root });
  let report = null;
  try {
    report = JSON.parse(audit.out);
  } catch { /* npm audit --json output unparseable */ }
  const vulns = report && report.metadata && report.metadata.vulnerabilities;
  const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
  const total = vulns ? SEVERITIES.reduce((sum, s) => sum + (vulns[s] || 0), 0) : null;
  if (total === null) warn(phase, 'npm audit result not parseable', audit.out.slice(0, 200));
  else if (total === 0) check(phase, 'npm audit: 0 vulnerabilities', true);
  else {
    const serious = Object.entries((report && report.vulnerabilities) || {})
      .filter(([, v]) => v.severity === 'high' || v.severity === 'critical')
      .map(([name, v]) => `${name} (${v.severity})`);
    warn(phase, `npm audit: ${total} vulnerabilities`,
      `${JSON.stringify(vulns)}${serious.length ? ` — ${serious.join(', ')}` : ''}`);
  }

  return { installDir, toolDir: path.join(installDir, 'node_modules', PKG_NAME) };
}

// ----------------------------------------------------------------------- phase 3: cherry-pick

function branches(repo, pattern = 'refs/heads') {
  const out = run('git', ['-C', repo, 'for-each-ref', '--format=%(refname:short)', pattern]).out.trim();
  return out ? out.split('\n') : [];
}

function gitOut(repo, args) {
  return run('git', ['-C', repo, ...args]);
}

// Fresh mutated repo + release run from tasks.txt. Extra args go to run-release.js.
function runFlow(root, toolDir, name, extra = []) {
  const repoDir = path.join(root, name);
  const mk = run('bash', [path.join(REPO_ROOT, 'scripts', 'sandbox', 'make-sandbox.sh'), repoDir]);
  if (mk.code !== 0) throw new Error(`make-sandbox failed: ${mk.out}`);
  const workDir = path.join(repoDir, 'work');
  const release = run('node', [
    path.join(REPO_ROOT, 'scripts', 'sandbox', 'run-release.js'),
    '-f', 'tasks.txt', '--work', workDir, '--tool', toolDir, ...extra
  ]);
  return { repoDir, workDir, out: release.out, code: release.code };
}

// One mutated scenario per branch: normal / conflict / already-applied / duplicate task ID
function assertSummary(phase, out) {
  const expectations = [
    ['PB-100', 'PROCEDE'],
    ['PB-I200', 'PROCEDE'],
    ['PB-300', 'CONFLICT'],
    ['PB-400', 'SKIPPED'],
    ['PB-500', 'PROCEDE']
  ];
  const lines = out.split('\n');
  for (const [taskId, status] of expectations) {
    const line = lines.find((l) => l.includes(`[${taskId}]`) && /— (PROCEDE|NO PROCEDE|CONFLICT|SKIPPED)/.test(l));
    check(phase, `${taskId} -> ${status}`, Boolean(line) && line.includes(status), line ? line.trim() : 'summary line not found');
  }
  check(phase, 'summary totals are 5/3/0/1/1',
    /Total: 5 \| PROCEDE: 3 \| NO PROCEDE: 0 \| CONFLICT: 1 \| SKIPPED: 1/.test(out));
}

// git state: the run must leave the workspace exactly as it found it
function assertCleanState(phase, workDir) {
  const porcelain = run('git', ['-C', workDir, 'status', '--porcelain']).out.trim();
  check(phase, 'work tree clean after the run', porcelain === '', porcelain);
  check(phase, 'no cherry-pick left in progress', !fs.existsSync(path.join(workDir, '.git', 'CHERRY_PICK_HEAD')));
  const head = run('git', ['-C', workDir, 'rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
  check(phase, 'back on the starting branch (staging)', head === 'staging', head);
}

// autoCreateMR=false (the shipped sandbox default): cherry-pick only, nothing leaves the machine
function phaseCherryPickNoPush(root, toolDir) {
  const phase = '3-cherry-pick (sin MR)';
  const { repoDir, workDir, out, code } = runFlow(root, toolDir, 'repo');
  check(phase, 'release flow exits 0', code === 0, out.split('\n').filter((l) => /error|ERR/i.test(l)).slice(0, 2).join(' | '));
  assertSummary(phase, out);
  assertCleanState(phase, workDir);

  const originBranches = branches(path.join(repoDir, 'origin.git'));
  check(phase, 'nothing pushed to origin (autoCreateMR=false)',
    !originBranches.some((b) => b.startsWith('release/')), originBranches.join(', '));

  const localRelease = branches(workDir, 'refs/heads/release/*');
  for (const branch of ['release/PB-100-list-user', 'release/PB-I200-favicon', 'release/PB-500-one']) {
    check(phase, `kept locally: ${branch}`, localRelease.includes(branch), localRelease.join(', '));
  }
  check(phase, 'no local leftovers for CONFLICT/SKIPPED',
    !localRelease.some((b) => b.includes('PB-300') || b.includes('PB-400')), localRelease.join(', '));

  // The cherry-pick really mutated the release branch — and only the tagged commits
  const picked = gitOut(workDir, ['log', 'release/PB-100-list-user', '--grep=\\[PB-100\\]', '--oneline']).out.trim().split('\n').filter(Boolean);
  check(phase, 'PB-100: exactly 2 tagged commits cherry-picked', picked.length === 2, picked.join(' | '));
  const onStaging = gitOut(workDir, ['log', 'staging', '--grep=\\[PB-100\\]', '--oneline']).out.trim();
  check(phase, 'PB-100: staging untouched', onStaging === '');
  const noise = gitOut(workDir, ['show', 'release/PB-100-list-user:noise.txt']);
  check(phase, 'untagged commit was not picked', noise.code !== 0);
  const conflicted = gitOut(workDir, ['show', 'release/PB-300-conflict:shared.txt']);
  check(phase, 'CONFLICT branch not created from a resolved state', conflicted.code !== 0);
}

// The tool reads the origin remote with `git remote get-url`, which applies url.*.insteadOf and
// would hand it the local bare path (parseRemoteUrl then fails and every GitLab call dies). The
// shim prints the raw configured URL instead; every other git command passes through untouched.
function installGitShim(root) {
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim() || 'git';
  const shim = `#!/usr/bin/env bash
real_git=${JSON.stringify(realGit)}
args=("$@")
for ((i = 0; i + 1 < \${#args[@]}; i++)); do
  if [ "\${args[i]}" = "remote" ] && [ "\${args[i+1]}" = "get-url" ]; then
    exec "$real_git" config --get remote.origin.url
  fi
done
exec "$real_git" "$@"
`;
  fs.writeFileSync(path.join(binDir, 'git'), shim, { mode: 0o755 });
  return binDir;
}

// Point origin at a GitLab-looking URL (so getProjectPathId works) while url.*.insteadOf keeps
// fetch/push talking to the local bare repo — nothing ever leaves the machine.
function fakeGitlabRemote(repoDir, workDir) {
  const fakeRemote = 'https://gitlab.example.com/sandbox/project.git';
  run('git', ['-C', workDir, 'remote', 'set-url', 'origin', fakeRemote]);
  fs.appendFileSync(path.join(workDir, '.git', 'config'),
    `\n[url "${path.join(repoDir, 'origin.git')}"]\n\tinsteadOf = ${fakeRemote}\n`);
  return fakeRemote;
}

function shimEnv(binDir) {
  return { PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
}

// autoCreateMR=true + --fake-gitlab: push to origin and MR creation through the real REST client
function phaseCherryPickWithMR(root, toolDir) {
  const phase = '3b-cherry-pick (con MR)';
  const repoDir = path.join(root, 'repo-mr');
  const mk = run('bash', [path.join(REPO_ROOT, 'scripts', 'sandbox', 'make-sandbox.sh'), repoDir]);
  check(phase, 'mutated sandbox repo created', mk.code === 0, mk.out.trim().split('\n').pop());

  const workDir = path.join(repoDir, 'work');
  const binDir = installGitShim(root);
  fakeGitlabRemote(repoDir, workDir);

  // Rewrite the sandbox config through the *installed* loader (the project key is derived from the
  // origin remote, so it changes with the remote URL): push + MR calls against the fake API host.
  const flipConfig = [
    'process.env.RELEASE_CHERRY_PICK_CONFIG_DIR = process.argv[1];',
    'const loader = require(process.argv[2] + "/src/config/loader");',
    'const config = loader.loadConfig() || {};',
    'config.release = Object.assign({}, config.release, { autoCreateMR: true });',
    'config.gitlab = Object.assign({}, config.gitlab, { host: "https://gitlab.example.com" });',
    'loader.saveConfig(config);',
    'console.log("config: " + loader.getConfigPath());'
  ].join('\n');
  const flip = run('node', ['-e', flipConfig, path.join(repoDir, 'config'), toolDir],
    { cwd: workDir, env: shimEnv(binDir) });
  check(phase, 'config flipped to autoCreateMR=true', flip.code === 0, flip.out.trim());
  const release = run('node', [
    path.join(REPO_ROOT, 'scripts', 'sandbox', 'run-release.js'),
    '-f', 'tasks.txt', '--work', workDir, '--tool', toolDir, '--fake-gitlab'
  ], { env: shimEnv(binDir) });
  const out = release.out;
  check(phase, 'release flow exits 0', release.code === 0, out.split('\n').filter((l) => /error|ERR/i.test(l)).slice(0, 2).join(' | '));
  assertSummary(phase, out);
  assertCleanState(phase, workDir);

  const originBranches = branches(path.join(repoDir, 'origin.git'));
  for (const branch of ['release/PB-100-list-user', 'release/PB-I200-favicon', 'release/PB-500-one']) {
    check(phase, `pushed: ${branch}`, originBranches.includes(branch), originBranches.join(', '));
  }
  for (const branch of ['release/PB-300-conflict', 'release/PB-400-already']) {
    check(phase, `not pushed: ${branch}`, !originBranches.includes(branch));
  }

  const posts = out.split('\n').filter((l) => l.includes('[fake-gitlab] POST') && l.includes('/merge_requests'));
  check(phase, 'one MR per PROCEDE branch', posts.length === 3, posts.join(' | '));
  check(phase, 'MR source_branch is the release branch',
    posts.some((l) => l.includes('"source_branch":"release/PB-100-list-user"')));
  check(phase, 'reviewer_ids sent to the API', posts.some((l) => l.includes('"reviewer_ids"')));
}

// Secrets must never leak: not to the console, not to generated reports, not to git metadata, and
// the config file itself must be private (0600/0700) and outside the target repo.
function phaseSecrets(root, toolDir) {
  const phase = '4-secretos';
  const TOKEN = 'glpat-9QwErTyUiOpAsDfGhJkLz';
  const AIKEY = 'sk-ant-api03-Ab12Cd34Ef56Gh78Ij90';

  const repoDir = path.join(root, 'repo-secret');
  const mk = run('bash', [path.join(REPO_ROOT, 'scripts', 'sandbox', 'make-sandbox.sh'), repoDir]);
  check(phase, 'sandbox created', mk.code === 0, mk.out.trim().split('\n').pop());
  const workDir = path.join(repoDir, 'work');
  const binDir = installGitShim(root);
  fakeGitlabRemote(repoDir, workDir);

  const configDir = path.join(repoDir, 'config');
  const writeConfig = [
    'process.env.RELEASE_CHERRY_PICK_CONFIG_DIR = process.argv[1];',
    'const loader = require(process.argv[2] + "/src/config/loader");',
    'const config = loader.loadConfig() || {};',
    'config.release = Object.assign({}, config.release, { autoCreateMR: true });',
    'config.gitlab = Object.assign({}, config.gitlab, { host: "https://gitlab.example.com", token: process.argv[3] });',
    'config.ai = Object.assign({}, config.ai, { apiKey: process.argv[4] });',
    'loader.saveConfig(config);',
    'console.log(loader.getConfigPath());'
  ].join('\n');
  const saved = run('node', ['-e', writeConfig, configDir, toolDir, TOKEN, AIKEY],
    { cwd: workDir, env: shimEnv(binDir) });
  const configPath = saved.out.trim().split('\n').pop();
  check(phase, 'config written outside the target repo', fs.existsSync(configPath) && configPath.startsWith(configDir), configPath);

  const mode = (p) => (fs.statSync(p).mode & 0o777).toString(8);
  check(phase, 'config file is 0600', mode(configPath) === '600', mode(configPath));
  check(phase, 'config dir is 0700', mode(configDir) === '700', mode(configDir));

  const release = run('node', [
    path.join(REPO_ROOT, 'scripts', 'sandbox', 'run-release.js'),
    '-f', 'tasks.txt', '--work', workDir, '--tool', toolDir, '--fake-gitlab', '--answer', 'saveReport=true'
  ], { env: shimEnv(binDir) });
  const out = release.out;
  check(phase, 'release flow exits 0', release.code === 0, out.split('\n').filter((l) => /error|ERR/i.test(l)).slice(0, 2).join(' | '));
  assertSummary(phase, out);
  assertCleanState(phase, workDir);

  // Nothing in the workspace (console output, reports, git metadata) may contain a raw secret
  const leaks = [];
  if (out.includes(TOKEN)) leaks.push('console output');
  if (out.includes(AIKEY)) leaks.push('console output (ai key)');
  for (const file of listFiles(workDir)) {
    if (file.startsWith(configDir)) continue;
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (content.includes(TOKEN) || content.includes(AIKEY)) leaks.push(`file: ${path.relative(workDir, file)}`);
  }
  check(phase, 'no raw secret in output, reports or git metadata', leaks.length === 0, leaks.join(', '));

  const summaryPath = path.join(workDir, 'release-summary.md');
  const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : '';
  check(phase, 'release-summary.md written and free of secrets', summary.includes('PROCEDE') && !summary.includes(TOKEN) && !summary.includes(AIKEY));

  const show = run(path.join(root, 'install', 'node_modules', '.bin', PKG_NAME), ['config', '--show'],
    { cwd: workDir, env: { ...shimEnv(binDir), RELEASE_CHERRY_PICK_CONFIG_DIR: configDir } });
  check(phase, 'config --show never prints raw secrets',
    show.code === 0 && !show.out.includes(TOKEN) && !show.out.includes(AIKEY));
  check(phase, 'config --show masks the token as glpat-****', /glpat-\*{4}/.test(show.out),
    (show.out.match(/glpat-[^\s"]*/) || ['not found'])[0]);
  check(phase, 'config --show masks the AI key as sk-ant-****', /sk-ant-\*{4}/.test(show.out),
    (show.out.match(/sk-ant-[^\s"]*/) || ['not found'])[0]);
}

function phaseCherryPick(root, toolDir) {
  phaseCherryPickNoPush(root, toolDir);
  phaseCherryPickWithMR(root, toolDir);
  phaseSecrets(root, toolDir);
}

// simple-git v4 strips ambient GIT_* variables from the git child process; git-auth.js depends on
// GIT_CONFIG_* getting through, so verify both halves: the token reaches git via createGit(), and a
// plain instance would drop it (i.e. the allow-list in src/git/instance.js is load-bearing).
function phaseGitAuthEnv(root) {
  const phase = '5-git-auth (simple-git v4, código local)';
  const toolDir = REPO_ROOT;
  const sgPkgPath = findInstalled('simple-git', path.join(REPO_ROOT, 'node_modules'));
  const version = sgPkgPath ? JSON.parse(fs.readFileSync(sgPkgPath, 'utf8')).version : 'missing';
  check(phase, 'local simple-git is >= 4.0.2 (fixes the criticals)',
    version !== 'missing' && !/^4\.0\.[01]$/.test(version) && Number(version.split('.')[0]) >= 4, version);

  const repo = path.join(root, 'repo', 'work');
  const script = [
    'const path = require("path");',
    'const tool = process.argv[1];',
    'const repo = process.argv[2];',
    'process.env.GIT_CONFIG_COUNT = "1";',
    'process.env.GIT_CONFIG_KEY_0 = "http.extraheader";',
    'process.env.GIT_CONFIG_VALUE_0 = "Authorization: Basic c2FuZGJveA==";',
    'const { createGit } = require(path.join(tool, "src/git/instance"));',
    'const { simpleGit } = require(require.resolve("simple-git", { paths: [tool] }));',
    '(async () => {',
    '  const allowed = await createGit().raw(["config", "--list"]);',
    '  const guarded = await simpleGit({ baseDir: repo }).raw(["config", "--list"]);',
    '  console.log(JSON.stringify({',
    '    allowed: /http\\.extraheader/.test(allowed) && /Authorization: Basic/.test(allowed),',
    '    guarded: /http\\.extraheader/.test(guarded)',
    '  }));',
    '})().catch((e) => { console.error(e); process.exit(1); });'
  ].join('\n');
  const res = run('node', ['-e', script, toolDir, repo], { cwd: repo });
  let out = null;
  try {
    out = JSON.parse(res.out.trim().split('\n').pop());
  } catch { /* unparseable */ }
  check(phase, 'GIT_CONFIG_* token header reaches git through createGit()',
    Boolean(out && out.allowed), res.out.trim().slice(0, 160));
  check(phase, 'plain instance strips it (allow-list is required)',
    Boolean(out && out.guarded === false));
}

// Locates <pkg>/package.json walking up from a node_modules dir (handles hoisted and nested layouts)
function findInstalled(pkg, fromDir) {
  let dir = fromDir;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, pkg, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ----------------------------------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  let version = '1.0.0';
  let sandbox = DEFAULT_SANDBOX;
  let keep = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--version') version = argv[++i];
    else if (argv[i] === '--sandbox') sandbox = path.resolve(argv[++i]);
    else if (argv[i] === '--keep') keep = true;
  }

  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.mkdirSync(sandbox, { recursive: true });
  const root = fs.realpathSync(sandbox);
  console.log(`\nSandbox: ${root}\n`);

  const artifact = await phaseSecurity(root, version);
  let installed = null;
  if (artifact) installed = phaseInstall(root, artifact.tarballPath, version);
  if (installed) {
    phaseCherryPick(root, installed.toolDir);
    phaseGitAuthEnv(root);
  }

  const failed = results.filter((r) => !r.ok);
  const warnings = results.filter((r) => r.name.startsWith('WARN '));
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Resultado: ${results.length - failed.length}/${results.length} checks OK` +
    (warnings.length ? `, ${warnings.length} warning(s)` : '') +
    (failed.length ? `, ${failed.length} FALLIDO(S)` : ''));
  for (const f of failed) console.log(`  FAIL [${f.phase}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  console.log(`Artefacto y config viven en: ${root}`);
  if (!keep) console.log('(usa --keep para no borrarlo en la próxima corrida)');
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
