import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { runWithDockerLock } from './docker-lock.mjs';
import { queryDiagnostics } from './query-diagnostics.mjs';
import { finding, run } from './tools.mjs';

const QUERY_GATE_SPECS = [
  'query-growth',
  'program-read-baseline',
  'user-consolidation-read-baseline',
];

export const QUERY_GATE_PATTERN = `(${QUERY_GATE_SPECS.join('|')})\\.integration\\.spec\\.ts$`;

const LIBPQ_DIRS = ['/opt/homebrew/opt/libpq/bin', '/usr/local/opt/libpq/bin'];

export const PSQL_MISSING = `psql not found on PATH or in ${LIBPQ_DIRS.join(', ')}; install libpq (brew install libpq) or add its bin directory to PATH`;

export function resolvePsql({
  path = process.env.PATH ?? '',
  exists = existsSync,
} = {}) {
  if (path.split(delimiter).some((dir) => dir && exists(join(dir, 'psql'))))
    return '';
  return LIBPQ_DIRS.find((dir) => exists(join(dir, 'psql'))) ?? null;
}

export async function checkQueryGates({
  cwd,
  source,
  runCommand,
  log = console.log,
  findPsql = resolvePsql,
}) {
  const findings = [];
  const lint = await (runCommand ?? run)(
    'pnpm',
    ['--filter', 'backend', 'run', 'query-lint:check'],
    { cwd, timeoutMs: 600_000 },
  );
  if (lint.code !== 0) {
    findings.push(
      finding(
        'query-lint',
        `pnpm --filter backend run query-lint:check exited ${lint.code}\n${queryDiagnostics(lint).text}`,
        `exit ${lint.code}`,
        'exit 0',
      ),
    );
  }
  if (source === 'ci') {
    log(
      `NOTICE query-gates: ${QUERY_GATE_SPECS.join(', ')} run once in the ci job's backend integration test step`,
    );
    return findings;
  }
  const psqlDir = findPsql();
  if (psqlDir === null) {
    findings.push(
      finding('query-growth', PSQL_MISSING, 'psql not found', 'psql on PATH'),
    );
    return findings;
  }
  const directory = mkdtempSync(join(tmpdir(), 'oss-hub-jest-'));
  const reportFile = join(directory, 'jest.json');
  writeFileSync(reportFile, '', { mode: 0o600, flag: 'wx' });
  const growth = await (runCommand ?? runWithDockerLock)(
    'bash',
    ['apps/backend/test/run-integration.sh'],
    {
      cwd,
      timeoutMs: 1_200_000,
      killGraceMs: 30_000,
      env: {
        BACKEND_INTEGRATION_TEST_PATTERN: QUERY_GATE_PATTERN,
        BACKEND_INTEGRATION_JEST_REPORT: reportFile,
        ...(psqlDir
          ? { PATH: `${psqlDir}${delimiter}${process.env.PATH ?? ''}` }
          : {}),
      },
    },
  );
  if (growth.code !== 0) {
    let report;
    try {
      report = JSON.parse(readFileSync(reportFile, 'utf8'));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    const diagnostics = queryDiagnostics(growth, { report, cwd, directory });
    findings.push(
      finding(
        'query-growth',
        `${QUERY_GATE_SPECS.join(', ')} integration specs failed\n${diagnostics.text}`,
        `exit ${growth.code}`,
        'exit 0',
      ),
    );
  } else {
    rmSync(directory, { recursive: true });
  }
  return findings;
}
