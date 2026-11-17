import assert from 'node:assert/strict';
import test from 'node:test';
import { main } from './index.mjs';
import { QUERY_GATE_PATTERN, checkQueryGates } from './query-gates.mjs';
import { classifyFiles } from './scope.mjs';
import { tempRepo } from './test-support.mjs';

test('query gates run only for backend repository, service, prisma and test changes', () => {
  for (const file of [
    'apps/backend/src/programs/programs.repository.ts',
    'apps/backend/src/programs/programs.service.ts',
    'apps/backend/prisma/schema.prisma',
    'apps/backend/test/query-growth.ts',
    'package.json',
  ]) {
    assert.equal(classifyFiles([file]).queryGates, true, file);
  }
  for (const file of [
    'apps/backend/src/programs/programs.controller.ts',
    'apps/frontend/src/app/page.tsx',
    'docs/readme.md',
  ]) {
    assert.equal(classifyFiles([file]).queryGates, false, file);
  }
});

async function runBackend(t, files) {
  const repo = tempRepo(t);
  const base = repo.commit('root', { 'docs/a.md': 'a\n' });
  repo.markRemoteMain(base);
  const head = repo.commit('change', files);
  const ran = [];
  const record = (name) => async () => {
    ran.push(name);
    return [];
  };
  const logs = [];
  const silenced = [console.log, console.error];
  console.log = (line) => logs.push(line);
  console.error = (line) => logs.push(line);
  try {
    const exit = await main(['backend', '--pre-push', 'origin', 'unused'], {
      cwd: repo.dir,
      env: {},
      stdin: `refs/heads/feature ${head} refs/heads/feature ${base}\n`,
      checks: {
        secrets: record('secrets'),
        api: record('api'),
        'query-gates': record('query-gates'),
      },
    });
    return { exit, ran, logs };
  } finally {
    [console.log, console.error] = silenced;
  }
}

test('verify backend runs the query gates for a repository change', async (t) => {
  const result = await runBackend(t, {
    'apps/backend/src/programs/programs.repository.ts': 'x\n',
  });
  assert.equal(result.exit, 0);
  assert.deepEqual(result.ran, ['secrets', 'api', 'query-gates']);
});

test('verify backend skips the query gates for a docs-only change', async (t) => {
  const result = await runBackend(t, { 'docs/b.md': 'b\n' });
  assert.equal(result.exit, 0);
  assert.deepEqual(result.ran, ['secrets', 'api']);
  assert.ok(result.logs.some((line) => /^SKIP query-gates:/.test(line)));
});

test('a lint violation inside the integration run is reported as query-lint', async () => {
  const findings = await checkQueryGates({
    cwd: '/repo',
    runCommand: async (command) =>
      command === 'pnpm'
        ? { code: 0, stdout: '', stderr: '' }
        : {
            code: 1,
            stdout: '',
            stderr:
              '    query-growth: /projects violated the query lint\n    [LINT.NO_LIMIT] Repo.findMany@apps/backend/src/x.repository.ts#X.list: no limit\n',
          },
  });
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['query-lint'],
  );
  assert.match(findings[0].message, /\[LINT\.NO_LIMIT\] Repo\.findMany/);
});

test('query gate failures block with rule ids and https sources', async () => {
  const calls = [];
  const findings = await checkQueryGates({
    cwd: '/repo',
    runCommand: async (command, args, options) => {
      calls.push({ command, args, env: options.env });
      return { code: 1, stdout: 'boom', stderr: '' };
    },
  });
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['query-lint', 'query-growth'],
  );
  assert.ok(findings.every((item) => /^https:\/\//.test(item.source)));
  assert.deepEqual(calls[0].args, [
    '--filter',
    'backend',
    'run',
    'query-lint:check',
  ]);
  assert.deepEqual(calls[1].env, {
    BACKEND_INTEGRATION_TEST_PATTERN: QUERY_GATE_PATTERN,
  });
  for (const spec of [
    'query-growth',
    'program-read-baseline',
    'user-consolidation-read-baseline',
  ]) {
    assert.match(
      `apps/backend/test/${spec}.integration.spec.ts`,
      new RegExp(QUERY_GATE_PATTERN),
    );
  }
});
