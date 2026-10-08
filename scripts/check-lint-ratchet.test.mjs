import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectDiagnostics,
  diagnosticIdentity,
  parseArguments,
  resolvePredecessor,
  runRatchet,
} from './check-lint-ratchet.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = path.join(REPO_ROOT, 'scripts/check-lint-ratchet.mjs');
const BACKEND = 'apps/backend/src/sample/example.js';
const FRONTEND = 'apps/frontend/src/app/example.js';
const BACKEND_SHARD = 'apps/backend/lint-baseline/sample.ndjson';
const FRONTEND_SHARD = 'apps/frontend/lint-baseline/app.ndjson';
const A = { file: BACKEND, ruleId: 'no-debugger', target: 'first' };
const B = { file: BACKEND, ruleId: 'no-debugger', target: 'second' };
const F = { file: FRONTEND, ruleId: 'no-debugger', target: 'frontend' };
const RULES = { backend: new Set(['no-debugger']), frontend: new Set(['no-debugger']) };

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lint-ratchet-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const remove = (file) => fs.rmSync(path.join(root, file), { recursive: true, force: true });
  const commit = () => {
    git('add', '.');
    git('commit', '--quiet', '--allow-empty', '-m', 'synthetic fixture');
    return git('rev-parse', 'HEAD');
  };
  const shards = (backend, frontend = []) => {
    write(BACKEND_SHARD, backend.map((entry) => JSON.stringify(entry)).join('\n') + (backend.length ? '\n' : ''));
    write(FRONTEND_SHARD, frontend.map((entry) => JSON.stringify(entry)).join('\n') + (frontend.length ? '\n' : ''));
  };
  const checkers = () => {
    write('scripts/check-lint-ratchet.mjs', 'export {};\n');
    write('scripts/check-knip-ratchet.mjs', 'export {};\n');
  };
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Synthetic Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  write(BACKEND, 'debugger;\n');
  write(FRONTEND, 'debugger;\n');
  const options = (baseSha, extra = {}) => ({ event: 'push', baseSha, headSha: git('rev-parse', 'HEAD'), ...extra });
  const run = (baseSha, diagnostics, extra = {}) => runRatchet(root, options(baseSha, extra), async () => ({ diagnostics, allowedRuleIds: RULES }));
  return { root, git, write, remove, commit, shards, checkers, options, run };
}

function existing(t, backend = [A], frontend = []) {
  const repo = fixture(t);
  repo.checkers();
  repo.shards(backend, frontend);
  return { ...repo, base: repo.commit() };
}

async function realOccurrenceFixture(t, source) {
  const repo = fixture(t);
  repo.write(BACKEND, source);
  repo.write(FRONTEND, 'export {};\n');
  const base = repo.commit();
  repo.checkers();
  for (const app of ['backend', 'frontend']) {
    const appRoot = path.join(repo.root, 'apps', app);
    const require = createRequire(path.join(REPO_ROOT, 'apps', app, 'package.json'));
    fs.mkdirSync(path.join(appRoot, 'node_modules'), { recursive: true });
    fs.symlinkSync(path.dirname(require.resolve('eslint/package.json')), path.join(appRoot, 'node_modules/eslint'), 'dir');
    repo.write(`apps/${app}/package.json`, '{"type":"module"}\n');
    repo.write(`apps/${app}/eslint.rails.mjs`, "export default [{ files: ['src/**/*.js'], rules: { 'no-debugger': 'error' } }];\n");
  }
  repo.write('.gitignore', 'node_modules/\n');
  repo.commit();
  await runRatchet(repo.root, repo.options(base, { seed: true }));
  const seededBase = repo.commit();
  return { ...repo, seededBase };
}

test('B1 real ESLint rejects a second identical debugger in the same file', async (t) => {
  const repo = await realOccurrenceFixture(t, 'debugger;\n');
  const baseline = fs.readFileSync(path.join(repo.root, BACKEND_SHARD), 'utf8');
  repo.write(BACKEND, 'debugger;\ndebugger;\n');
  repo.commit();
  await assert.rejects(
    runRatchet(repo.root, repo.options(repo.seededBase)),
    /unlisted-diagnostic|occurrence-growth|multiplicity-growth/,
  );
  assert.equal(fs.readFileSync(path.join(repo.root, BACKEND_SHARD), 'utf8'), baseline);
});

test('B1 real ESLint exposes stale multiplicity when one identical occurrence is removed', async (t) => {
  const repo = await realOccurrenceFixture(t, 'debugger;\ndebugger;\n');
  repo.write(BACKEND, 'debugger;\n');
  repo.commit();
  await assert.rejects(
    runRatchet(repo.root, repo.options(repo.seededBase)),
    /stale-entry|stale-multiplicity/,
  );
});

test('B1 real ESLint keeps an occurrence stable across blank-line movement', async (t) => {
  const repo = await realOccurrenceFixture(t, 'debugger;\n');
  const baseline = fs.readFileSync(path.join(repo.root, BACKEND_SHARD), 'utf8');
  repo.write(BACKEND, '\n\ndebugger;\n\n');
  repo.commit();
  const result = await runRatchet(repo.root, repo.options(repo.seededBase));
  assert.equal(result.mode, 'ratchet');
  assert.equal(result.entries.size, 1);
  assert.equal(fs.readFileSync(path.join(repo.root, BACKEND_SHARD), 'utf8'), baseline);
});

test('B1 real ESLint pruning removes only the stale identical occurrence', async (t) => {
  const repo = await realOccurrenceFixture(t, 'debugger;\ndebugger;\n');
  const seeded = fs.readFileSync(path.join(repo.root, BACKEND_SHARD), 'utf8').trim().split('\n');
  assert.equal(seeded.length, 2);
  assert.notEqual(JSON.parse(seeded[0]).target, JSON.parse(seeded[1]).target);
  repo.write(BACKEND, '\n\ndebugger;\n');
  repo.commit();
  await runRatchet(repo.root, repo.options(repo.seededBase, { prune: true }));
  const pruned = fs.readFileSync(path.join(repo.root, BACKEND_SHARD), 'utf8').trim().split('\n');
  assert.equal(pruned.length, 1);
  assert.ok(seeded.includes(pruned[0]));
  assert.equal((await runRatchet(repo.root, repo.options(repo.seededBase))).entries.size, 1);
});

test('collector preserves distinct cycle messageIds at the same zero-width location', async (t) => {
  const repo = fixture(t);
  const messageIds = [`cycle_${'a'.repeat(64)}`, `cycle_${'b'.repeat(64)}`];
  for (const app of ['backend', 'frontend']) {
    const appRoot = path.join(repo.root, 'apps', app);
    const require = createRequire(path.join(REPO_ROOT, 'apps', app, 'package.json'));
    fs.mkdirSync(path.join(appRoot, 'node_modules'), { recursive: true });
    fs.symlinkSync(path.dirname(require.resolve('eslint/package.json')), path.join(appRoot, 'node_modules/eslint'), 'dir');
    repo.write(`apps/${app}/package.json`, '{"type":"module"}\n');
    repo.write(`apps/${app}/eslint.rails.mjs`, `
const ids = ${JSON.stringify(messageIds)};
const rule = {
  meta: { schema: [], messages: Object.fromEntries(ids.map((id) => [id, 'Directed cycle'])) },
  create(context) {
    return {
      Program(node) {
        for (const messageId of ids) context.report({
          node, messageId,
          loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
        });
      },
    };
  },
};
export default [{
  files: ['src/**/*.js'],
  plugins: { architecture: { rules: { 'no-cycle': rule } } },
  rules: { 'architecture/no-cycle': 'error' },
}];
`);
  }
  const first = (await collectDiagnostics(repo.root)).diagnostics.filter((entry) => entry.file === BACKEND);
  assert.equal(first.length, 2);
  assert.notEqual(first[0].target, first[1].target);
  for (const id of messageIds) assert.equal(first.filter((entry) => entry.target.startsWith(`${id}:`)).length, 1);
  repo.write(BACKEND, '\n\ndebugger;\n');
  const moved = (await collectDiagnostics(repo.root)).diagnostics.filter((entry) => entry.file === BACKEND);
  assert.deepEqual(moved, first);
});

test('unencoded duplicate collector identities fail instead of silently coalescing', async (t) => {
  const repo = existing(t);
  repo.commit();
  await assert.rejects(repo.run(repo.base, [A, A]), /duplicate-diagnostic/);
});

test('B2 lint cannot remove its last baseline while the Knip family retains debt', async (t) => {
  const repo = existing(t, []);
  const zero = { files: 0, exports: 0, types: 0, dependencies: 0, devDependencies: 0, unlisted: 0, binaries: 0 };
  repo.write('knip-baseline.json', JSON.stringify({
    version: 1,
    workspaces: { '.': zero, 'apps/backend': { ...zero, exports: 1 }, 'apps/frontend': zero },
  }));
  const jointBase = repo.commit();
  repo.remove('apps/backend/lint-baseline');
  repo.remove('apps/frontend/lint-baseline');
  const partialBase = repo.commit();
  await assert.rejects(repo.run(jointBase, []), /retire|retirement|baseline-missing/);
  repo.commit();
  await assert.rejects(repo.run(partialBase, []), /retire|retirement|baseline-missing/);
});

test('B2 lint permits joint zero removal and the following retired predecessor', async (t) => {
  const repo = existing(t, []);
  const zero = { files: 0, exports: 0, types: 0, dependencies: 0, devDependencies: 0, unlisted: 0, binaries: 0 };
  repo.write('knip-baseline.json', JSON.stringify({
    version: 1,
    workspaces: { '.': zero, 'apps/backend': zero, 'apps/frontend': zero },
  }));
  const jointBase = repo.commit();
  repo.remove('apps/backend/lint-baseline');
  repo.remove('apps/frontend/lint-baseline');
  repo.remove('knip-baseline.json');
  const retiredBase = repo.commit();
  assert.equal((await repo.run(jointBase, [])).entries.size, 0);
  repo.commit();
  assert.equal((await repo.run(retiredBase, [])).mode, 'retired');
});

test('lint retains its zero marker while even a zero Knip budget remains', async (t) => {
  const repo = existing(t, []);
  const zero = { files: 0, exports: 0, types: 0, dependencies: 0, devDependencies: 0, unlisted: 0, binaries: 0 };
  repo.write('knip-baseline.json', JSON.stringify({
    version: 1,
    workspaces: { '.': zero, 'apps/backend': zero, 'apps/frontend': zero },
  }));
  const jointBase = repo.commit();
  repo.remove('apps/backend/lint-baseline');
  repo.remove('apps/frontend/lint-baseline');
  repo.commit();
  await assert.rejects(repo.run(jointBase, []), /joint-retirement/);
});

test('push compares the before tree even when origin/main points at the head', async (t) => {
  const repo = existing(t);
  const head = repo.commit();
  repo.git('update-ref', 'refs/remotes/origin/main', head);
  const result = await repo.run(repo.base, [A]);
  assert.equal(result.mode, 'ratchet');
  assert.equal(result.baseSha, repo.base);
  repo.shards([A, B]);
  const grown = repo.commit();
  repo.git('update-ref', 'refs/remotes/origin/main', grown);
  await assert.rejects(repo.run(repo.base, [A, B]), /baseline-growth/);
});

test('unlisted findings and same-count baseline swaps fail', async (t) => {
  const repo = existing(t);
  repo.commit();
  await assert.rejects(repo.run(repo.base, [A, B]), /unlisted-diagnostic/);
  repo.shards([B]);
  repo.commit();
  await assert.rejects(repo.run(repo.base, [B]), /baseline-growth/);
});

test('frontend findings cannot escape through a backend-only ratchet', async (t) => {
  const repo = existing(t, [A], [F]);
  repo.commit();
  assert.equal((await repo.run(repo.base, [A, F])).entries.size, 2);
  repo.shards([A], [{ ...F, target: 'replacement' }]);
  repo.commit();
  await assert.rejects(repo.run(repo.base, [A, { ...F, target: 'replacement' }]), /baseline-growth/);
});

test('lowered findings require lowering the committed baseline', async (t) => {
  const repo = existing(t, [A, B]);
  repo.commit();
  await assert.rejects(repo.run(repo.base, [A]), /stale-entry/);
  repo.shards([A]);
  repo.commit();
  assert.equal((await repo.run(repo.base, [A])).entries.size, 1);
});

test('deleted source and shard owners fail until stale entries are pruned', async (t) => {
  const repo = existing(t);
  repo.remove(BACKEND);
  repo.commit();
  await assert.rejects(repo.run(repo.base, []), /deleted-file/);
  repo.remove('apps/backend/src/sample');
  repo.commit();
  await assert.rejects(repo.run(repo.base, []), /deleted-shard/);
  await repo.run(repo.base, [], { prune: true });
  assert.equal(fs.existsSync(path.join(repo.root, BACKEND_SHARD)), false);
  assert.equal((await repo.run(repo.base, [])).entries.size, 0);
});

test('renames cannot carry debt into a new path or a new shard', async (t) => {
  const repo = existing(t);
  const renamed = { ...A, file: 'apps/backend/src/sample/renamed.js' };
  repo.git('mv', BACKEND, renamed.file);
  repo.shards([renamed]);
  repo.commit();
  await assert.rejects(repo.run(repo.base, [renamed]), /baseline-growth/);
  repo.remove(BACKEND_SHARD);
  repo.write('apps/backend/src/other/example.js', 'debugger;\n');
  const moved = { ...A, file: 'apps/backend/src/other/example.js' };
  repo.write('apps/backend/lint-baseline/other.ndjson', JSON.stringify(moved));
  repo.commit();
  await assert.rejects(repo.run(repo.base, [moved]), /new-shard/);
});

test('rules outside the allowlist fail even for existing predecessor debt', async (t) => {
  const invalid = { ...A, ruleId: 'unapproved-rule' };
  const repo = existing(t, [invalid]);
  repo.commit();
  await assert.rejects(repo.run(repo.base, [invalid]), /rule-not-allowed/);
  await assert.rejects(repo.run(repo.base, [], { prune: true }), /rule-not-allowed/);
});

test('prune is sorted, repeatable and never admits new debt', async (t) => {
  const repo = existing(t, [B, A]);
  repo.commit();
  await repo.run(repo.base, [B, A], { prune: true });
  const expected = `${JSON.stringify(A)}\n${JSON.stringify(B)}\n`;
  assert.equal(fs.readFileSync(path.join(repo.root, BACKEND_SHARD), 'utf8'), expected);
  await repo.run(repo.base, [A, B], { prune: true });
  assert.equal(fs.readFileSync(path.join(repo.root, BACKEND_SHARD), 'utf8'), expected);
  await repo.run(repo.base, [B], { prune: true });
  assert.equal(fs.readFileSync(path.join(repo.root, BACKEND_SHARD), 'utf8'), `${JSON.stringify(B)}\n`);
  await assert.rejects(repo.run(repo.base, [A, B], { prune: true }), /unlisted-diagnostic/);
  repo.shards([A, B, { ...A, target: 'third' }]);
  await assert.rejects(repo.run(repo.base, [A], { prune: true }), /baseline-growth/);
});

test('one-time seed equals actual findings and cannot be padded', async (t) => {
  const repo = fixture(t);
  const base = repo.commit();
  repo.checkers();
  repo.shards([A], [F]);
  repo.commit();
  assert.equal((await repo.run(base, [A, F])).mode, 'seed');
  repo.shards([A, B], [F]);
  await assert.rejects(repo.run(base, [A, F]), /stale-entry/);
});

test('seed writer creates exact shards, refuses overwrite and cannot reseed', async (t) => {
  const repo = fixture(t);
  const base = repo.commit();
  repo.checkers();
  repo.commit();
  const seeded = await repo.run(base, [A, F], { seed: true });
  assert.equal(seeded.mode, 'seed');
  assert.equal(fs.readFileSync(path.join(repo.root, BACKEND_SHARD), 'utf8'), `${JSON.stringify(A)}\n`);
  assert.equal(fs.readFileSync(path.join(repo.root, FRONTEND_SHARD), 'utf8'), `${JSON.stringify(F)}\n`);
  await assert.rejects(repo.run(base, [A, F], { seed: true }), /seed-forbidden/);
  const seededBase = repo.commit();
  repo.remove('apps/backend/lint-baseline');
  repo.remove('apps/frontend/lint-baseline');
  repo.commit();
  await assert.rejects(repo.run(seededBase, [A], { seed: true }), /seed-forbidden/);
});

test('seed fails without both introducing checkers', async (t) => {
  const repo = fixture(t);
  const base = repo.commit();
  repo.write('scripts/check-lint-ratchet.mjs', 'export {};\n');
  repo.shards([A]);
  repo.commit();
  await assert.rejects(repo.run(base, [A]), /seed-checkers-missing/);
});

test('missing predecessor baselines fail closed except zero retired mode', async (t) => {
  const repo = fixture(t);
  repo.checkers();
  const base = repo.commit();
  repo.commit();
  await assert.rejects(repo.run(base, [A]), /baseline-missing/);
  assert.equal((await repo.run(base, [])).mode, 'retired');
  repo.shards([]);
  await assert.rejects(repo.run(base, []), /baseline-missing/);
  await assert.rejects(repo.run(base, [], { seed: true }), /seed-forbidden/);
});

test('either existing checker or Knip baseline prevents a second seed', async (t) => {
  for (const marker of ['scripts/check-lint-ratchet.mjs', 'scripts/check-knip-ratchet.mjs', 'knip-baseline.json']) {
    const repo = fixture(t);
    repo.write(marker, '{}\n');
    const base = repo.commit();
    repo.checkers();
    repo.shards([A]);
    repo.commit();
    await assert.rejects(repo.run(base, [A]), /baseline-missing/);
  }
});

test('removing all baselines is allowed only when actual findings reach zero', async (t) => {
  const repo = existing(t);
  repo.remove('apps/backend/lint-baseline');
  repo.remove('apps/frontend/lint-baseline');
  const retiredBase = repo.commit();
  await assert.rejects(repo.run(repo.base, [A]), /unlisted-diagnostic/);
  assert.equal((await repo.run(repo.base, [])).entries.size, 0);
  repo.commit();
  assert.equal((await repo.run(retiredBase, [])).mode, 'retired');
});

test('zero, unavailable and nonancestor push predecessors fail before collection', async (t) => {
  const repo = existing(t);
  const sibling = repo.commit();
  repo.git('checkout', '--quiet', '--detach', repo.base);
  repo.write('sibling.txt', 'different branch\n');
  const head = repo.commit();
  for (const baseSha of ['0'.repeat(40), 'f'.repeat(40), sibling, head]) {
    let collected = false;
    await assert.rejects(runRatchet(repo.root, repo.options(baseSha), async () => {
      collected = true;
      return { diagnostics: [], allowedRuleIds: RULES };
    }), /base-unavailable|non-ancestor-before/);
    assert.equal(collected, false);
  }
  assert.throws(() => resolvePredecessor(repo.root, repo.options(repo.base, { headSha: sibling })), /head-mismatch/);
});

test('PR comparison computes the merge-base instead of reading base-tip additions', async (t) => {
  const repo = existing(t);
  repo.shards([A, B]);
  const baseTip = repo.commit();
  repo.git('checkout', '--quiet', '--detach', repo.base);
  repo.write('head.txt', 'PR branch\n');
  repo.shards([A, B]);
  repo.commit();
  const options = repo.options(baseTip, { event: 'pull_request' });
  assert.equal(resolvePredecessor(repo.root, options), repo.base);
  await assert.rejects(runRatchet(repo.root, options, async () => ({ diagnostics: [A, B], allowedRuleIds: RULES })), /baseline-growth/);
  repo.git('checkout', '--quiet', '--orphan', 'unrelated');
  repo.write('unrelated.txt', 'unrelated history\n');
  const unrelated = repo.commit();
  assert.throws(() => resolvePredecessor(repo.root, repo.options(baseTip, { event: 'pull_request', headSha: unrelated })), /base-unavailable/);
});

test('local mode fails when origin cannot be fetched rather than comparing to HEAD', (t) => {
  const repo = existing(t);
  repo.commit();
  assert.throws(() => resolvePredecessor(repo.root, {}), /base-unavailable/);
});

test('local mode fetches main and uses its merge-base', (t) => {
  const origin = existing(t);
  const repo = fixture(t);
  repo.remove('apps');
  repo.git('remote', 'add', 'origin', origin.root);
  repo.git('fetch', '--quiet', 'origin', 'main');
  repo.git('checkout', '--quiet', '-B', 'work', 'origin/main');
  repo.write('local.txt', 'local branch\n');
  repo.commit();
  assert.equal(resolvePredecessor(repo.root, {}), origin.base);
});

test('argument parsing rejects incomplete or ambiguous event contracts', () => {
  const sha = 'a'.repeat(40);
  assert.deepEqual(parseArguments(['--event', 'push', '--base-sha', sha, '--head-sha', sha], {}), {
    event: 'push', baseSha: sha, headSha: sha, prune: false, seed: false,
  });
  assert.equal(parseArguments(['--base-sha', sha, '--head-sha', sha], { GITHUB_EVENT_NAME: 'pull_request' }).event, 'pull_request');
  for (const args of [
    ['--base-sha', sha], ['--head-sha', sha], ['--base-sha'], ['--event', 'push'],
    ['--base-sha', sha, '--head-sha', sha], ['--seed', '--prune'], ['--seed', '--seed'], ['--unknown'],
    ['--event', 'schedule', '--base-sha', sha, '--head-sha', sha],
  ]) assert.throws(() => parseArguments(args, {}), /arguments/);
  assert.throws(() => parseArguments([], { CI: 'true' }), /arguments/);
});

test('malformed, duplicate and incorrectly sharded identities cannot enter a seed', async (t) => {
  const repo = fixture(t);
  const base = repo.commit();
  repo.checkers();
  repo.commit();
  for (const content of [
    '{', `${JSON.stringify(A)}\n${JSON.stringify(A)}`,
    JSON.stringify({ ...A, line: 4 }), JSON.stringify({ ...A, file: '../escape.js' }),
    JSON.stringify({ ...A, file: FRONTEND }), JSON.stringify({ ...A, target: '' }),
  ]) {
    repo.write(BACKEND_SHARD, content);
    await assert.rejects(repo.run(base, []), /baseline-schema/);
  }
});

test('baseline symlinks are refused rather than read outside the checkout', async (t) => {
  const repo = existing(t);
  repo.remove(BACKEND_SHARD);
  fs.symlinkSync(path.join(repo.root, FRONTEND_SHARD), path.join(repo.root, BACKEND_SHARD));
  repo.commit();
  await assert.rejects(repo.run(repo.base, []), /baseline-schema/);
});

test('identity ignores line movement but distinguishes the offending source target', () => {
  const result = { filePath: '/synthetic/apps/backend/src/sample/example.js' };
  const message = { ruleId: 'no-debugger', messageId: 'unexpected', nodeType: 'DebuggerStatement', line: 1, column: 1, endLine: 1, endColumn: 10 };
  const first = diagnosticIdentity('/synthetic', result, message, 'debugger;\n');
  const moved = diagnosticIdentity('/synthetic', result, { ...message, line: 3, endLine: 3 }, '\n\ndebugger;\n');
  assert.deepEqual(moved, first);
  assert.notDeepEqual(diagnosticIdentity('/synthetic', result, message, 'different\n'), first);
  assert.throws(() => diagnosticIdentity('/synthetic', result, { ...message, fatal: true }, 'debugger;'), /eslint-diagnostic/);
  assert.throws(() => diagnosticIdentity('/synthetic', result, { ...message, ruleId: null }, 'debugger;'), /eslint-diagnostic/);
});

test('CLI seeds and checks both real ESLint rails, then rejects frontend growth', (t) => {
  const repo = fixture(t);
  const base = repo.commit();
  repo.checkers();
  for (const app of ['backend', 'frontend']) {
    const appRoot = path.join(repo.root, 'apps', app);
    const require = createRequire(path.join(REPO_ROOT, 'apps', app, 'package.json'));
    fs.mkdirSync(path.join(appRoot, 'node_modules'), { recursive: true });
    fs.symlinkSync(path.dirname(require.resolve('eslint/package.json')), path.join(appRoot, 'node_modules/eslint'), 'dir');
    repo.write(`apps/${app}/package.json`, '{"type":"module"}\n');
    repo.write(`apps/${app}/eslint.rails.mjs`, "export default [{ files: ['src/**/*.js'], rules: { 'no-debugger': 'error' } }];\n");
  }
  repo.write('.gitignore', 'node_modules/\nsummary.txt\n');
  const head = repo.commit();
  const invoke = (...args) => spawnSync(process.execPath, [CHECKER, '--event', 'push', '--base-sha', base, '--head-sha', repo.git('rev-parse', 'HEAD'), ...args], {
    cwd: repo.root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: '', GITHUB_STEP_SUMMARY: path.join(repo.root, 'summary.txt') },
  });
  const seeded = invoke('--seed');
  assert.equal(seeded.status, 0, seeded.stderr);
  assert.match(seeded.stdout, /Lint ratchet: seed/);
  assert.match(fs.readFileSync(path.join(repo.root, 'summary.txt'), 'utf8'), /seed/);
  const checked = invoke();
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /2 identities/);
  repo.commit();
  repo.write('apps/frontend/src/app/new.js', 'debugger;\n');
  repo.commit();
  const grown = invoke();
  assert.equal(grown.status, 1);
  assert.match(grown.stderr, /unlisted-diagnostic/);
  assert.notEqual(repo.git('rev-parse', 'HEAD'), head);
});
