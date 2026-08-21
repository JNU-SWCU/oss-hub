import assert from 'node:assert/strict';
import {
  accessSync,
  chmodSync,
  constants,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateMigrationLedger } from './prisma-migration-ledger.mjs';

const runnerPath = fileURLToPath(
  new URL('./test-prisma-migration-concurrency.sh', import.meta.url),
);
const workflowPath = new URL('../.github/workflows/ci.yml', import.meta.url);

test('required CI runs migration concurrency immediately after backend integration', () => {
  // Given
  accessSync(runnerPath, constants.X_OK);
  const workflow = readFileSync(workflowPath, 'utf8');

  // When / Then
  assert.match(
    workflow,
    /- name: backend integration test\s+if: \$\{\{ steps\.scope\.outputs\.backend == 'true' \}\}\s+run: pnpm --filter backend test:integration\s+- name: Prisma migration concurrency\s+if: \$\{\{ steps\.scope\.outputs\.backend == 'true' \}\}\s+run: bash scripts\/test-prisma-migration-concurrency\.sh/,
  );
  assert.match(workflow, /- 'scripts\/check-open-prisma-migration-prs\*'/);
  assert.match(workflow, /- 'scripts\/test-prisma-migration-concurrency\*'/);
});

test('concurrency runner starts both deploys before waiting and checks both exits', () => {
  // Given
  const runner = readFileSync(runnerPath, 'utf8');

  // When / Then
  assert.match(
    runner,
    /run_deploy >"\$first_log" 2>&1 &\s+first_pid=\$!\s+run_deploy >"\$second_log" 2>&1 &\s+second_pid=\$!\s+set \+e\s+wait "\$first_pid"\s+first_status=\$\?\s+wait "\$second_pid"\s+second_status=\$\?/,
  );
  assert.match(
    runner,
    /if \[\[ \$first_status -ne 0 \|\| \$second_status -ne 0 \]\]; then/,
  );
});

test('concurrency runner rejects a failed deploy process', () => {
  // Given
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), 'prisma-concurrency-failure-'),
  );
  const fakeDocker = join(fixtureRoot, 'docker');
  const fakePnpm = join(fixtureRoot, 'pnpm');
  writeFileSync(
    fakeDocker,
    `#!/usr/bin/env bash
if [[ "$*" == *" port postgres 5432"* ]]; then
  printf '127.0.0.1:54321\\n'
fi
exit 0
`,
  );
  writeFileSync(fakePnpm, '#!/usr/bin/env bash\nexit 9\n');
  chmodSync(fakeDocker, 0o755);
  chmodSync(fakePnpm, 0o755);

  // When
  const result = spawnSync(runnerPath, [], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fixtureRoot}:${process.env.PATH ?? ''}` },
  });
  rmSync(fixtureRoot, { recursive: true, force: true });

  // Then
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deploy failed \(first=9 second=9\)/);
});

test('ledger accepts one finished row for every committed migration', () => {
  // Given
  const committed = ['001_first', '002_second'];
  const rows = committed.map((migrationName) => ({
    migrationName,
    finishedAt: new Date(0),
    rolledBackAt: null,
  }));

  // When
  const issues = validateMigrationLedger(committed, rows);

  // Then
  assert.deepEqual(issues, []);
});

test('ledger rejects an unfinished migration', () => {
  // Given
  const committed = ['001_first'];
  const rows = [
    { migrationName: '001_first', finishedAt: null, rolledBackAt: null },
  ];

  // When
  const issues = validateMigrationLedger(committed, rows);

  // Then
  assert.deepEqual(issues, ['unfinished:001_first']);
});

test('ledger rejects a rolled-back migration', () => {
  // Given
  const committed = ['001_first'];
  const rows = [
    {
      migrationName: '001_first',
      finishedAt: new Date(0),
      rolledBackAt: new Date(1),
    },
  ];

  // When
  const issues = validateMigrationLedger(committed, rows);

  // Then
  assert.deepEqual(issues, ['rolled-back:001_first']);
});

test('ledger rejects duplicate and missing migration rows', () => {
  // Given
  const committed = ['001_first', '002_second'];
  const row = {
    migrationName: '001_first',
    finishedAt: new Date(0),
    rolledBackAt: null,
  };

  // When
  const issues = validateMigrationLedger(committed, [row, row]);

  // Then
  assert.deepEqual(issues, ['count:001_first:2', 'count:002_second:0']);
});
