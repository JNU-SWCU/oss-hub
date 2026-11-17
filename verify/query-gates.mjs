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

export async function checkQueryGates({
  cwd,
  source,
  runCommand = run,
  log = console.log,
}) {
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
  if (source === 'ci') {
    log(
      `NOTICE query-gates: ${QUERY_GATE_SPECS.join(', ')} run once in the ci job's backend integration test step`,
    );
    return findings;
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
    const violations = [
      ...new Set(
        `${growth.stdout}\n${growth.stderr}`
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => /^\[LINT\.[A-Z_]+\]/.test(line)),
      ),
    ];
    findings.push(
      violations.length > 0
        ? finding(
            'query-lint',
            `a query on a measured route violated the query lint\n${violations.join('\n')}\n${tail(growth)}`,
            `${violations.length} violation(s)`,
            '0 violations',
          )
        : finding(
            'query-growth',
            `${QUERY_GATE_SPECS.join(', ')} integration specs failed\n${tail(growth)}`,
            `exit ${growth.code}`,
            'exit 0',
          ),
    );
  }
  return findings;
}
