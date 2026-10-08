import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APPS = ['backend', 'frontend'];
const CHECKERS = ['scripts/check-lint-ratchet.mjs', 'scripts/check-knip-ratchet.mjs'];
const BASELINES = APPS.map((app) => `apps/${app}/lint-baseline/`);
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function fail(code, detail) {
  throw new Error(`${code}: ${detail}`);
}

function git(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch {
    fail('base-unavailable', `git ${args[0]} failed`);
  }
}

function commit(root, sha, label) {
  if (!SHA.test(sha) || /^0+$/.test(sha)) fail('base-unavailable', `${label} must be a nonzero full SHA`);
  if (git(root, ['rev-parse', '--verify', `${sha}^{commit}`]) !== sha) {
    fail('base-unavailable', `${label} is not a commit`);
  }
  return sha;
}

export function parseArguments(args, env = process.env) {
  const options = { event: env.GITHUB_EVENT_NAME, prune: false, seed: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (seen.has(flag)) fail('arguments', `duplicate ${flag}`);
    seen.add(flag);
    if (flag === '--prune' || flag === '--seed') {
      options[flag.slice(2)] = true;
    } else if (['--base-sha', '--head-sha', '--event'].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) fail('arguments', `missing value for ${flag}`);
      options[{ '--base-sha': 'baseSha', '--head-sha': 'headSha', '--event': 'event' }[flag]] = value;
    } else {
      fail('arguments', `unknown option ${flag}`);
    }
  }
  if (options.prune && options.seed) fail('arguments', '--seed and --prune are exclusive');
  if (Boolean(options.baseSha) !== Boolean(options.headSha)) fail('arguments', 'base and head SHAs are required together');
  if (options.baseSha && !['push', 'pull_request'].includes(options.event)) {
    fail('arguments', 'explicit SHAs require --event push|pull_request or GITHUB_EVENT_NAME');
  }
  if (!options.baseSha && (options.event || env.CI === 'true')) {
    fail('arguments', 'CI/event invocation requires explicit base and head SHAs');
  }
  return options;
}

export function resolvePredecessor(root, options) {
  const checkedHead = git(root, ['rev-parse', 'HEAD']);
  if (!options.baseSha) {
    git(root, ['fetch', '--no-tags', 'origin', 'main']);
    const base = git(root, ['merge-base', 'HEAD', 'origin/main']);
    return commit(root, base, 'local merge-base');
  }
  const head = commit(root, options.headSha, 'head');
  const base = commit(root, options.baseSha, 'base');
  if (checkedHead !== head) fail('head-mismatch', 'checkout HEAD differs from the event head SHA');
  if (options.event === 'pull_request') {
    return commit(root, git(root, ['merge-base', base, head]), 'PR merge-base');
  }
  if (options.event !== 'push') fail('arguments', 'unsupported event');
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', base, head], { cwd: root });
  if (ancestor.status !== 0 || base === head) fail('non-ancestor-before', 'push base must be a strict ancestor of head');
  return base;
}

function isBaseline(file) {
  return BASELINES.some((prefix) => file.startsWith(prefix));
}

function regularFile(root, file) {
  const absolute = path.resolve(root, file);
  try {
    return fs.lstatSync(absolute).isFile() && fs.realpathSync(absolute) === absolute;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

function readPredecessor(root, sha) {
  const tree = new Map();
  for (const record of git(root, ['ls-tree', '-rz', '--full-tree', sha]).split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, type] = record.slice(0, tab).split(' ');
    tree.set(record.slice(tab + 1), { mode, type });
  }
  const shards = new Map();
  for (const [file, entry] of tree) {
    if (!isBaseline(file)) continue;
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) fail('baseline-schema', 'baseline must be a regular file');
    shards.set(file, git(root, ['show', `${sha}:${file}`]));
  }
  return { tree, shards };
}

function readHeadShards(root) {
  const shards = new Map();
  for (const prefix of BASELINES) {
    const directory = path.resolve(root, prefix);
    if (!fs.existsSync(directory)) continue;
    if (!fs.lstatSync(directory).isDirectory() || fs.realpathSync(directory) !== directory) {
      fail('baseline-schema', 'baseline directory must not be a symlink');
    }
    for (const name of fs.readdirSync(directory).sort()) {
      const file = prefix + name;
      if (!regularFile(root, file)) fail('baseline-schema', 'baseline shards must be regular files');
      shards.set(file, fs.readFileSync(path.join(root, file), 'utf8'));
    }
  }
  return shards;
}

export function shardFor(file) {
  const match = /^apps\/(backend|frontend)\/(.+)$/.exec(file);
  if (!match || file.includes('\\') || file.split('/').some((part) => !part || part === '.' || part === '..')) {
    fail('baseline-schema', 'file must be an app-relative repository path');
  }
  const [, app, relative] = match;
  if (relative.startsWith('lint-baseline/')) fail('baseline-schema', 'a baseline cannot name itself');
  const parts = relative.split('/');
  const shard = parts[0] === 'src' && parts.length > 2 ? parts[1] : 'root';
  if (!/^[a-zA-Z0-9_-]+$/.test(shard)) fail('baseline-schema', 'invalid shard owner');
  return `apps/${app}/lint-baseline/${shard}.ndjson`;
}

function identity(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      Object.keys(entry).sort().join(',') !== 'file,ruleId,target' ||
      !['file', 'ruleId', 'target'].every((key) => typeof entry[key] === 'string' && entry[key].length > 0)) {
    fail('baseline-schema', 'expected exactly {file, ruleId, target} strings');
  }
  shardFor(entry.file);
  return JSON.stringify({ file: entry.file, ruleId: entry.ruleId, target: entry.target });
}

function parseShards(shards) {
  const entries = new Map();
  for (const [shard, content] of shards) {
    if (!/^apps\/(backend|frontend)\/lint-baseline\/[a-zA-Z0-9_-]+\.ndjson$/.test(shard)) {
      fail('baseline-schema', 'invalid shard path');
    }
    for (const line of content.split('\n').filter((line) => line.trim())) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        fail('baseline-schema', 'invalid NDJSON');
      }
      const key = identity(entry);
      if (shardFor(entry.file) !== shard) fail('baseline-schema', 'entry is in the wrong shard');
      if (entries.has(key)) fail('baseline-schema', 'duplicate identity');
      entries.set(key, entry);
    }
  }
  return entries;
}

function requireSubset(left, right, code) {
  for (const key of left.keys()) if (!right.has(key)) fail(code, key);
}

function validateLive(root, shards, entries, allowedRuleIds) {
  for (const shard of shards.keys()) {
    const [, app, owner] = /^apps\/(backend|frontend)\/lint-baseline\/(.+)\.ndjson$/.exec(shard);
    const ownerPath = owner === 'root' ? `apps/${app}` : `apps/${app}/src/${owner}`;
    if (!fs.existsSync(path.join(root, ownerPath))) fail('deleted-shard', shard);
  }
  for (const entry of entries.values()) {
    if (!regularFile(root, entry.file)) fail('deleted-file', entry.file);
    const app = entry.file.split('/')[1];
    if (!allowedRuleIds[app]?.has(entry.ruleId)) fail('rule-not-allowed', entry.ruleId);
  }
}

export function evaluateRatchet({ root, predecessor, headShards, diagnostics, allowedRuleIds, prune = false }) {
  const previous = parseShards(predecessor.shards);
  const head = parseShards(headShards);
  const actual = new Map(diagnostics.map((entry) => [identity(entry), entry]));
  let mode;
  if (predecessor.shards.size > 0) {
    mode = 'ratchet';
    requireSubset(headShards, predecessor.shards, 'new-shard');
    requireSubset(head, previous, 'baseline-growth');
  } else if (!CHECKERS.some((file) => predecessor.tree.has(file)) && !predecessor.tree.has('knip-baseline.json')) {
    mode = 'seed';
    if (!CHECKERS.every((file) => regularFile(root, file))) fail('seed-checkers-missing', 'P1 must introduce both checkers');
  } else {
    if (headShards.size > 0 || actual.size > 0) fail('baseline-missing', 'no reseeding after checker introduction; retirement requires zero findings');
    return { mode: 'retired', entries: actual, shards: new Map() };
  }
  validateLive(root, new Map(), actual, allowedRuleIds);
  for (const entry of head.values()) {
    if (!allowedRuleIds[entry.file.split('/')[1]]?.has(entry.ruleId)) fail('rule-not-allowed', entry.ruleId);
  }
  requireSubset(actual, head, 'unlisted-diagnostic');
  if (!prune || mode === 'seed') {
    validateLive(root, headShards, head, allowedRuleIds);
    requireSubset(head, actual, 'stale-entry');
  }
  return { mode, entries: actual, shards: serializeShards(actual.values(), headShards, root) };
}

function serializeShards(entries, existing, root) {
  const grouped = new Map();
  for (const entry of entries) {
    const shard = shardFor(entry.file);
    if (!grouped.has(shard)) grouped.set(shard, []);
    grouped.get(shard).push(identity(entry));
  }
  for (const app of APPS) {
    const prefix = `apps/${app}/lint-baseline/`;
    if (![...grouped.keys()].some((file) => file.startsWith(prefix))) {
      const keep = [...existing.keys()].filter((file) => file.startsWith(prefix)).sort().find((file) => {
        const owner = path.basename(file, '.ndjson');
        return fs.existsSync(path.join(root, `apps/${app}`, owner === 'root' ? '' : `src/${owner}`));
      });
      if (keep) grouped.set(keep, []);
    }
  }
  return new Map([...grouped].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([file, lines]) => [file, lines.sort().join('\n') + (lines.length ? '\n' : '')]));
}

function writeShards(root, oldShards, newShards) {
  for (const [file, content] of newShards) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  for (const file of oldShards.keys()) if (!newShards.has(file)) fs.unlinkSync(path.join(root, file));
}

export function diagnosticIdentity(root, result, message, source) {
  if (message.fatal || !message.ruleId) fail('eslint-diagnostic', 'fatal or ruleless diagnostic cannot be baselined');
  const file = path.relative(root, result.filePath).split(path.sep).join('/');
  const lines = source.split(/\r?\n/);
  let target = '<file>';
  if (message.line !== undefined) {
    if (!Number.isInteger(message.line) || message.line < 1 || message.line > lines.length) fail('eslint-diagnostic', 'invalid source location');
    const startColumn = (message.column ?? 1) - 1;
    if (message.endLine !== undefined && message.endColumn !== undefined) {
      const selected = lines.slice(message.line - 1, message.endLine);
      selected[selected.length - 1] = selected.at(-1).slice(0, message.endColumn - 1);
      selected[0] = selected[0].slice(startColumn);
      target = selected.join('\n');
    } else {
      target = lines[message.line - 1].slice(startColumn);
    }
  }
  return {
    file,
    ruleId: message.ruleId,
    target: `${message.messageId ?? message.ruleId}:${message.nodeType ?? 'file'}:${createHash('sha256').update(target).digest('hex')}`,
  };
}

export async function collectDiagnostics(root) {
  const diagnostics = [];
  const allowedRuleIds = {};
  for (const app of APPS) {
    const cwd = path.join(root, 'apps', app);
    const configFile = path.join(cwd, 'eslint.rails.mjs');
    if (!regularFile(root, `apps/${app}/eslint.rails.mjs`)) fail('rails-unavailable', app);
    const require = createRequire(path.join(cwd, 'package.json'));
    const { ESLint } = require('eslint');
    const config = (await import(pathToFileURL(configFile).href)).default;
    if (!Array.isArray(config)) fail('rails-config', 'expected a flat config array');
    allowedRuleIds[app] = new Set(config.flat(Infinity).flatMap((entry) => Object.entries(entry.rules ?? {}).filter(([, value]) => {
      const severity = Array.isArray(value) ? value[0] : value;
      return severity !== 0 && severity !== 'off';
    }).map(([rule]) => rule)));
    const eslint = new ESLint({ cwd, overrideConfigFile: configFile, allowInlineConfig: false });
    const results = await eslint.lintFiles(['.']);
    if (results.length === 0) fail('eslint-empty', `${app} did not lint any files`);
    for (const result of results) {
      const source = result.source ?? fs.readFileSync(result.filePath, 'utf8');
      for (const message of result.messages) diagnostics.push(diagnosticIdentity(root, result, message, source));
    }
  }
  return { diagnostics, allowedRuleIds };
}

export async function runRatchet(root, options, collect = collectDiagnostics) {
  const baseSha = resolvePredecessor(root, options);
  const predecessor = readPredecessor(root, baseSha);
  const headShards = readHeadShards(root);
  const findings = await collect(root);
  if (options.seed) {
    if (predecessor.shards.size || CHECKERS.some((file) => predecessor.tree.has(file)) || predecessor.tree.has('knip-baseline.json')) {
      fail('seed-forbidden', 'only the checker-introducing predecessor permits --seed');
    }
    if (headShards.size) fail('seed-forbidden', 'head baselines already exist');
    const entries = new Map(findings.diagnostics.map((entry) => [identity(entry), entry]));
    const seedShards = serializeShards(entries.values(), new Map(APPS.map((app) => [`apps/${app}/lint-baseline/root.ndjson`, ''])), root);
    const result = evaluateRatchet({ root, predecessor, headShards: seedShards, ...findings });
    writeShards(root, headShards, seedShards);
    return { ...result, baseSha };
  }
  const result = evaluateRatchet({ root, predecessor, headShards, ...findings, prune: options.prune });
  if (options.prune) writeShards(root, headShards, result.shards);
  return { ...result, baseSha };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const result = await runRatchet(root, options);
  const rows = [...result.shards].map(([file, content]) => `| ${file} | ${content.split('\n').filter(Boolean).length} |`);
  const summary = [`Lint ratchet: ${result.mode}; predecessor ${result.baseSha}; ${result.entries.size} identities`, '', '| Shard | Identities |', '| --- | ---: |', ...rows, ''].join('\n');
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`lint-ratchet: ${error.message}`);
    process.exitCode = 1;
  });
}
