import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { main } from './index.mjs';
import {
  PSQL_MISSING,
  QUERY_GATE_PATTERN,
  checkQueryGates,
  resolvePsql,
} from './query-gates.mjs';
import { classifyFiles } from './scope.mjs';
import { join } from 'node:path';
import { tempRepo } from './test-support.mjs';
import { REPO_ROOT } from './tools.mjs';

test('query gates run only for backend repository, service, prisma and test changes', () => {
  for (const file of [
    'apps/backend/src/programs/programs.repository.ts',
    'apps/backend/src/programs/programs.service.ts',
    'apps/backend/src/programs/programs.controller.ts',
    'apps/backend/src/platform/runtime-config.config.ts',
    'apps/backend/prisma/schema.prisma',
    'apps/backend/test/query-growth.ts',
    'package.json',
  ]) {
    assert.equal(classifyFiles([file]).queryGates, true, file);
  }
  for (const file of [
    'apps/backend/src/programs/programs.service.spec.ts',
    'apps/frontend/src/app/page.tsx',
    'docs/readme.md',
  ]) {
    assert.equal(classifyFiles([file]).queryGates, false, file);
  }
});

async function recordChecks(argv, options) {
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
    const exit = await main(argv, {
      env: {},
      ...options,
      checks: Object.fromEntries(
        ['secrets', 'api', 'query-gates', 'cwv'].map((name) => [
          name,
          record(name),
        ]),
      ),
    });
    return { exit, ran, logs };
  } finally {
    [console.log, console.error] = silenced;
  }
}

const EVERY_CHECK = ['secrets', 'api', 'query-gates', 'cwv'];

test('verify full runs every check on an already-pushed checkout', async (t) => {
  const repo = tempRepo(t);
  const head = repo.commit('root', { 'docs/a.md': 'a\n' });
  repo.markRemoteMain(head);
  const result = await recordChecks(['full'], {
    cwd: repo.dir,
    reportDir: join(repo.dir, 'reports'),
  });
  assert.equal(result.exit, 0);
  assert.deepEqual(result.ran, EVERY_CHECK);
});

test('verify full runs every check for a docs-only change', async (t) => {
  const repo = tempRepo(t);
  repo.markRemoteMain(repo.commit('root', { 'docs/a.md': 'a\n' }));
  repo.commit('docs', { 'docs/b.md': 'b\n' });
  const result = await recordChecks(['full'], {
    cwd: repo.dir,
    reportDir: join(repo.dir, 'reports'),
  });
  assert.equal(result.exit, 0);
  assert.deepEqual(result.ran, EVERY_CHECK);
  assert.equal(
    result.logs.some((line) => /^SKIP /.test(String(line))),
    false,
  );
});

test('in CI the query gates lint but leave the gate specs to the ci job', async () => {
  const calls = [];
  const notices = [];
  const findings = await checkQueryGates({
    cwd: '/repo',
    source: 'ci',
    log: (line) => notices.push(line),
    runCommand: async (command, args) => {
      calls.push([command, ...args]);
      return { code: 1, stdout: '[LINT.NO_LIMIT] audit mismatch', stderr: '' };
    },
  });
  assert.deepEqual(calls, [
    ['pnpm', '--filter', 'backend', 'run', 'query-lint:check'],
  ]);
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['query-lint'],
  );
  assert.match(notices[0], /^NOTICE query-gates: .*ci job/);
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
    findPsql: () => '',
    runCommand: async (command) =>
      command === 'pnpm'
        ? { code: 0, stdout: '', stderr: '' }
        : {
            code: 1,
            stdout: '',
            stderr:
              '    query-growth: /projects violated the query lint\n    [LINT.NO_LIMIT] Repo.findMany@apps/backend/src/x.repository.ts#X.list: no limit\nFAIL prisma/program-read-baseline.integration.spec.ts\n',
          },
  });
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['query-lint'],
  );
  assert.match(findings[0].message, /\[LINT\.NO_LIMIT\] Repo\.findMany/);
  assert.match(findings[0].message, /FAIL prisma\/program-read-baseline/);
});

test('query gate failures block with rule ids and https sources', async () => {
  const calls = [];
  const findings = await checkQueryGates({
    cwd: '/repo',
    findPsql: () => '',
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
});

test('the gate pattern selects exactly the three committed gate specs', () => {
  const specs = execFileSync(
    'git',
    ['ls-files', 'apps/backend/**/*.integration.spec.ts'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter((file) => new RegExp(QUERY_GATE_PATTERN).test(file));
  assert.deepEqual(specs.sort(), [
    'apps/backend/prisma/program-read-baseline.integration.spec.ts',
    'apps/backend/prisma/user-consolidation-read-baseline.integration.spec.ts',
    'apps/backend/test/query-growth.integration.spec.ts',
  ]);
});

test('a missing psql fails the query gates with one actionable line', async () => {
  const calls = [];
  const findings = await checkQueryGates({
    cwd: '/repo',
    findPsql: () => null,
    runCommand: async (command) => {
      calls.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  assert.deepEqual(calls, ['pnpm']);
  assert.deepEqual(
    findings.map((item) => [item.rule, item.message]),
    [['query-growth', PSQL_MISSING]],
  );
  assert.match(PSQL_MISSING, /install libpq/);
  assert.doesNotMatch(PSQL_MISSING, /\n/);
});

test('psql from a libpq directory is put on the integration PATH', async () => {
  const calls = [];
  await checkQueryGates({
    cwd: '/repo',
    findPsql: () => '/opt/homebrew/opt/libpq/bin',
    runCommand: async (command, args, options) => {
      calls.push(options.env);
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  assert.match(calls[1].PATH, /^\/opt\/homebrew\/opt\/libpq\/bin/);
});

test('resolvePsql prefers PATH, then the libpq directories', () => {
  const at = (paths) => (file) => paths.includes(file);
  assert.equal(
    resolvePsql({ path: '/usr/bin', exists: at(['/usr/bin/psql']) }),
    '',
  );
  assert.equal(
    resolvePsql({
      path: '/usr/bin',
      exists: at(['/usr/local/opt/libpq/bin/psql']),
    }),
    '/usr/local/opt/libpq/bin',
  );
  assert.equal(resolvePsql({ path: '/usr/bin', exists: at([]) }), null);
});
