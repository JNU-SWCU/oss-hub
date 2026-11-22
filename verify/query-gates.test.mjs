import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { main } from './index.mjs';
import {
  PSQL_MISSING,
  QUERY_GATE_PATTERN,
  checkQueryGates,
  resolvePsql,
} from './query-gates.mjs';
import { dirname, join } from 'node:path';
import { eventFile, tempRepo } from './test-support.mjs';
import { REPO_ROOT } from './tools.mjs';
import { queryDiagnostics } from './query-diagnostics.mjs';

test('unlabelled credential-shaped assertion values are redacted', (t) => {
  const credentials = [
    `AKIA${'SYNTHETIC1234567'}`,
    `ASIA${'EXAMPLE012345678'}`,
    `ghp_${'abcDEF0123456789'.repeat(3)}`,
    `github_pat_${'abcDEF0123456789'.repeat(4)}`,
    `Bearer ${'abcDEF0123456789'.repeat(3)}`,
    'aZ8kR2sP9vN4mQ6tX1cB7hW3',
  ];
  for (const credential of credentials) {
    const result = queryDiagnostics(
      {
        stdout: '',
        stderr: `FAIL test/private.integration.spec.ts\n  ● protects values\n    Received: "${credential}"`,
      },
      { jest: true },
    );
    assert.ok(!result.text.includes(credential));
    assert.match(result.text, /\[REDACTED\]/);
    const log = /Full local log: (.+)/.exec(result.text)[1];
    t.after(() => rmSync(dirname(log), { recursive: true, force: true }));
    assert.ok(readFileSync(log, 'utf8').includes(credential));
  }
});

test('hook query specs match the blocking CI integration lane and its base coverage', async (t) => {
  const frontend = 'apps/frontend/src/app/page.tsx';
  const backend = 'apps/backend/src/programs/programs.repository.ts';
  for (const [paths, destination, expectedQuery, expectedApi] of [
    [[frontend], 'feature', true, false],
    [[backend], 'feature', true, true],
    [[frontend, backend], 'feature', true, true],
    [
      ['apps/backend/src/programs/programs.service.spec.ts'],
      'feature',
      true,
      true,
    ],
    [['knip.json'], 'feature', true, false],
    [['pnpm-lock.yaml'], 'feature', true, true],
    [['docs/readme.md'], 'feature', false, false],
    [['docs/readme.md'], 'main', true, false],
    [['.github/workflows/ci.yml'], 'feature', true, true],
  ]) {
    await t.test(`${paths.join(' + ')} -> ${destination}`, async (t) => {
      const repo = tempRepo(t);
      const base = repo.commit('base');
      const head = repo.commit(
        'change',
        Object.fromEntries(paths.map((path) => [path, 'x\n'])),
      );
      const push = destination === 'main';
      const ci = {
        cwd: repo.dir,
        env: {
          GITHUB_ACTIONS: 'true',
          GITHUB_EVENT_NAME: push ? 'push' : 'pull_request',
          GITHUB_REF: push ? 'refs/heads/main' : 'refs/pull/7/merge',
          GITHUB_SHA: head,
          GITHUB_EVENT_PATH: eventFile(
            t,
            push ? { before: base } : { pull_request: { base: { sha: base } } },
          ),
        },
      };
      const scope = await recordChecks(['scope'], ci);
      assert.equal(scope.exit, 0);
      const ciIntegration = JSON.parse(scope.logs[0]).backend;
      assert.equal(ciIntegration, expectedQuery);
      const hook = await recordChecks(
        ['scoped', '--pre-push', 'origin', 'unused'],
        {
          cwd: repo.dir,
          stdin: `HEAD ${head} refs/heads/${destination} ${base}\n`,
        },
      );
      const ciVerify = await recordChecks(['scoped'], ci);
      assert.equal(hook.exit, 0);
      assert.equal(ciVerify.exit, 0);
      assert.deepEqual(ciVerify.ran, hook.ran);
      assert.equal(hook.ran.includes('query-gates'), ciIntegration);
      assert.equal(hook.ran.includes('api'), expectedApi);
      assert.ok(hook.ran.includes('secrets'));
    });
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
  assert.match(findings[0].message, /\[LINT\.NO_LIMIT\]/);
  assert.match(findings[0].message, /FAIL prisma\/program-read-baseline/);
});

test('a query failure retains Jest diagnostics above the integration output tail', async () => {
  const findings = await checkQueryGates({
    cwd: '/repo',
    source: 'pre-push',
    findPsql: () => '',
    runCommand: async (command) =>
      command === 'pnpm'
        ? { code: 0, stdout: '', stderr: '' }
        : {
            code: 1,
            stdout: 'Database migrations applied',
            stderr: [
              'FAIL test/query-growth.integration.spec.ts',
              '  ● query growth › bounds the number of reads',
              '    Expected: <= 4',
              '    Received:    9',
              ...Array.from({ length: 20 }, () => '    at test stack frame'),
              'Test Suites: 1 failed, 2 passed, 3 total',
            ].join('\n'),
          },
  });
  assert.equal(findings.length, 1);
  assert.match(
    findings[0].message,
    /FAIL test\/query-growth\.integration\.spec\.ts/,
  );
  assert.match(
    findings[0].message,
    /query growth › bounds the number of reads/,
  );
  assert.match(findings[0].message, /Expected: <= 4\n\s+Received:\s+9/);
});

test('hook output is a bounded redacted Jest summary and the raw log is private', async (t) => {
  const bearer = 'synthetic-access-token-1234567890';
  const opaque = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789ABCD';
  const filler = 'q'.repeat(1024 * 1024);
  const findings = await checkQueryGates({
    cwd: '/repo',
    source: 'pre-push',
    findPsql: () => '',
    runCommand: async (command) =>
      command === 'pnpm'
        ? { code: 0, stdout: '', stderr: '' }
        : {
            code: 7,
            stdout: 'unrelated output',
            stderr: [
              `Authorization: Bearer ${bearer}`,
              filler,
              'FAIL test/query-growth.integration.spec.ts',
              '  ● bounds reads',
              '    Expected: 4',
              `    Received: { apiKey: "${opaque}" }`,
              '    at test stack frame',
              'Test Suites: 1 failed',
            ].join('\n'),
          },
  });
  const message = findings[0].message;
  assert.ok(Buffer.byteLength(message) < 4096);
  assert.doesNotMatch(
    message,
    new RegExp(`${bearer}|${opaque}|stack frame|Test Suites`),
  );
  assert.match(
    message,
    /FAIL test\/query-growth\.integration\.spec\.ts\n\s+● bounds reads\n\s+Expected: 4\n\s+Received:/,
  );
  const path = /Full local log: (.+)/.exec(message)?.[1];
  assert.ok(path);
  t.after(() => rmSync(dirname(path), { recursive: true, force: true }));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const raw = readFileSync(path, 'utf8');
  assert.ok(
    raw.includes(filler) &&
      raw.includes(bearer) &&
      raw.includes('unrelated output'),
  );
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
