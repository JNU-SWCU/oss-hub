import assert from 'node:assert/strict';
import test from 'node:test';
import { ZERO, eventFile, tempRepo } from './test-support.mjs';
import { classifyFiles, resolveRanges, resolveScope } from './scope.mjs';
import { VerifyError, run } from './tools.mjs';

test('classifyFiles applies the D1 scope table', () => {
  assert.deepEqual(classifyFiles(['apps/frontend/src/app/page.tsx']), {
    frontend: true,
    backend: false,
    both: false,
    securityAlways: true,
  });
  assert.equal(classifyFiles(['apps/backend/src/main.ts']).backend, true);
  assert.equal(classifyFiles(['apps/backend/src/main.ts']).frontend, false);
  for (const file of [
    'verify/api.mjs',
    '.githooks/pre-push',
    'package.json',
    'pnpm-lock.yaml',
    'compose.dev.yml',
    '.github/workflows/ci.yml',
  ]) {
    const scope = classifyFiles([file]);
    assert.equal(scope.both && scope.frontend && scope.backend, true, file);
  }
  const docs = classifyFiles(['docs/readme.md', 'apps/frontend-old/x.ts']);
  assert.deepEqual(docs, {
    frontend: false,
    backend: false,
    both: false,
    securityAlways: true,
  });
});

function branchedRepo(t) {
  const repo = tempRepo(t);
  const root = repo.commit('root', { 'docs/a.md': 'a\n' });
  repo.markRemoteMain(root);
  repo.git('checkout', '-q', '-b', 'feature');
  const feature = repo.commit('frontend change', {
    'apps/frontend/src/x.ts': 'x\n',
  });
  repo.git('checkout', '-q', '-b', 'other', root);
  const other = repo.commit('backend change', {
    'apps/backend/src/y.ts': 'y\n',
  });
  repo.git('checkout', '-q', 'feature');
  return { repo, root, feature, other };
}

test('pre-push reads every ref line, skips deletions, and merge-bases new branches from their own SHA', async (t) => {
  const { repo, root, feature, other } = branchedRepo(t);
  const stdin = [
    `refs/heads/feature ${feature} refs/heads/feature ${ZERO}`,
    `(delete) ${ZERO} refs/heads/gone ${root}`,
    `refs/heads/other ${other} refs/heads/other ${root}`,
    '',
  ].join('\n');
  const scope = await resolveScope({
    cwd: repo.dir,
    source: 'pre-push',
    stdin,
  });
  assert.deepEqual(
    scope.ranges.map(({ base, head }) => ({ base, head })),
    [
      { base: root, head: feature },
      { base: root, head: other },
    ],
  );
  assert.deepEqual(scope.files, [
    'apps/backend/src/y.ts',
    'apps/frontend/src/x.ts',
  ]);
  assert.equal(scope.frontend && scope.backend && !scope.both, true);
});

test('a new branch that is not HEAD uses the merge-base of its own SHA', async (t) => {
  const repo = tempRepo(t);
  const root = repo.commit('root', { 'docs/a.md': 'a\n' });
  repo.git('checkout', '-q', '-b', 'feature');
  repo.commit('feature', { 'docs/feature.md': 'f\n' });
  repo.git('checkout', '-q', 'main');
  const newerMain = repo.commit('main moves', { 'docs/main.md': 'm\n' });
  repo.markRemoteMain(newerMain);
  repo.git('checkout', '-q', '-b', 'other');
  const other = repo.commit('other', { 'docs/other.md': 'o\n' });
  repo.git('checkout', '-q', 'feature');
  const ranges = await resolveRanges({
    cwd: repo.dir,
    source: 'pre-push',
    stdin: `refs/heads/other ${other} refs/heads/other ${ZERO}\n`,
  });
  assert.notEqual(newerMain, root);
  assert.deepEqual(
    ranges.map(({ base, head }) => ({ base, head })),
    [{ base: newerMain, head: other }],
  );
});

test('pre-push with only a deletion line yields no ranges', async (t) => {
  const { repo, root } = branchedRepo(t);
  const ranges = await resolveRanges({
    cwd: repo.dir,
    source: 'pre-push',
    stdin: `(delete) ${ZERO} refs/heads/gone ${root}\n`,
  });
  assert.deepEqual(ranges, []);
});

test('pre-push fails closed on malformed stdin', async (t) => {
  const { repo } = branchedRepo(t);
  for (const stdin of [
    'garbage\n',
    'refs/heads/a 123 refs/heads/a 456\n',
    '\u0000\u0001 binary',
  ]) {
    await assert.rejects(
      resolveRanges({ cwd: repo.dir, source: 'pre-push', stdin }),
      (error) =>
        error instanceof VerifyError &&
        /malformed pre-push/.test(error.message),
    );
  }
});

test('pre-push fails closed when the remote SHA is unknown or no merge-base exists', async (t) => {
  const { repo, feature } = branchedRepo(t);
  await assert.rejects(
    resolveRanges({
      cwd: repo.dir,
      source: 'pre-push',
      stdin: `refs/heads/feature ${feature} refs/heads/feature ${'a'.repeat(40)}\n`,
    }),
    /not available locally/,
  );
  repo.git('checkout', '-q', '--orphan', 'island');
  const island = repo.commit('unrelated', { 'island.txt': 'i\n' });
  await assert.rejects(
    resolveRanges({
      cwd: repo.dir,
      source: 'pre-push',
      stdin: `refs/heads/island ${island} refs/heads/island ${ZERO}\n`,
    }),
    /no merge-base/,
  );
});

test('CI pull_request uses base.sha and push uses before', async (t) => {
  const { repo, root, feature } = branchedRepo(t);
  const pr = await resolveRanges({
    cwd: repo.dir,
    source: 'ci',
    env: {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventFile(t, {
        pull_request: { base: { sha: root } },
      }),
      GITHUB_SHA: feature,
    },
  });
  assert.deepEqual([pr[0].base, pr[0].head], [root, feature]);
  const push = await resolveRanges({
    cwd: repo.dir,
    source: 'ci',
    env: {
      GITHUB_EVENT_NAME: 'push',
      GITHUB_EVENT_PATH: eventFile(t, { before: root, after: feature }),
      GITHUB_SHA: feature,
    },
  });
  assert.deepEqual([push[0].base, push[0].head], [root, feature]);
});

test('CI fails closed when the base is missing or not fetched', async (t) => {
  const { repo, feature } = branchedRepo(t);
  const env = (payload, name = 'pull_request') => ({
    GITHUB_EVENT_NAME: name,
    GITHUB_EVENT_PATH: eventFile(t, payload),
    GITHUB_SHA: feature,
  });
  await assert.rejects(
    resolveRanges({
      cwd: repo.dir,
      source: 'ci',
      env: env({ pull_request: {} }),
    }),
    /no base\.sha/,
  );
  await assert.rejects(
    resolveRanges({
      cwd: repo.dir,
      source: 'ci',
      env: env({ before: 'b'.repeat(40) }, 'push'),
    }),
    /not available locally/,
  );
  await assert.rejects(
    resolveRanges({ cwd: repo.dir, source: 'ci', env: env({}, 'schedule') }),
    /unsupported GitHub event/,
  );
});

test('run kills a hung command at its deadline', async () => {
  await assert.rejects(
    run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 300,
    }),
    /timed out after 300ms/,
  );
});
