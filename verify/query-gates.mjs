import { finding, run } from './tools.mjs';

const QUERY_GATE_SPECS = [
  'query-growth',
  'program-read-baseline',
  'user-consolidation-read-baseline',
];

export const QUERY_GATE_PATTERN = `(${QUERY_GATE_SPECS.join('|')})\\.integration\\.spec\\.ts$`;

function tail(result) {
  return `${result.stdout}\n${result.stderr}`
    .trim()
    .split('\n')
    .slice(-15)
    .join('\n');
}

export async function checkQueryGates({ cwd, runCommand = run }) {
  const findings = [];
  const lint = await runCommand(
    'pnpm',
    ['--filter', 'backend', 'run', 'query-lint:check'],
    { cwd, timeoutMs: 600_000 },
  );
  if (lint.code !== 0) {
    findings.push(
      finding(
        'query-lint',
        `pnpm --filter backend run query-lint:check exited ${lint.code}\n${tail(lint)}`,
        `exit ${lint.code}`,
        'exit 0',
      ),
    );
  }
  const growth = await runCommand(
    'bash',
    ['apps/backend/test/run-integration.sh'],
    {
      cwd,
      timeoutMs: 1_200_000,
      env: { BACKEND_INTEGRATION_TEST_PATTERN: QUERY_GATE_PATTERN },
    },
  );
  if (growth.code !== 0) {
    findings.push(
      finding(
        'query-growth',
        `${QUERY_GATE_SPECS.join(', ')} integration specs failed\n${tail(growth)}`,
        `exit ${growth.code}`,
        'exit 0',
      ),
    );
  }
  return findings;
}
