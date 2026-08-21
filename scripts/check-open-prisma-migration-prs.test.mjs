import assert from 'node:assert/strict';
import {
  accessSync,
  chmodSync,
  constants,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';

const checkerPath = fileURLToPath(
  new URL('./check-open-prisma-migration-prs.sh', import.meta.url),
);
const fixtureRoot = mkdtempSync(join(tmpdir(), 'prisma-pr-mutex-'));
const fakeGh = join(fixtureRoot, 'gh');
writeFileSync(
  fakeGh,
  `#!/usr/bin/env bash
set -euo pipefail
case "\${GH_FIXTURE_MODE}:$*" in
  clear:*pulls\\?state=open*) printf '41\\n' ;;
  clear:*pulls/41/files*) printf 'docs/rules/example.md\\n' ;;
  competing:*pulls\\?state=open*) printf '42\\n' ;;
  competing:*pulls/42/files*) printf 'apps/backend/prisma/schema.prisma\\n' ;;
  backfill:*pulls\\?state=open*) printf '43\\n' ;;
  backfill:*pulls/43/files*) printf 'apps/backend/prisma/member-authority-backfill.ts\\n' ;;
  current:*pulls\\?state=open*) printf '44\\n' ;;
  failure:*) exit 7 ;;
  *) exit 8 ;;
esac
`,
);
chmodSync(fakeGh, 0o755);

after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function runChecker(mode, currentPullRequest = '0') {
  return spawnSync(checkerPath, [currentPullRequest], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_FIXTURE_MODE: mode,
      PATH: `${fixtureRoot}:${process.env.PATH ?? ''}`,
    },
  });
}

test('open Prisma migration mutex checker is executable', () => {
  // Given
  const executableMode = constants.X_OK;

  // When / Then
  assert.doesNotThrow(() => accessSync(checkerPath, executableMode));
});

test('mutex passes when open pull requests do not touch migration paths', () => {
  // Given / When
  const result = runChecker('clear');

  // Then
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'clear',
    checkedOpenPullRequests: 1,
  });
});

test('mutex rejects a competing Prisma schema pull request', () => {
  // Given / When
  const result = runChecker('competing');

  // Then
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), {
    status: 'blocked',
    competingPullRequest: 42,
  });
});

test('mutex rejects a competing authority backfill pull request', () => {
  // Given / When
  const result = runChecker('backfill');

  // Then
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), {
    status: 'blocked',
    competingPullRequest: 43,
  });
});

test('mutex excludes the current pull request from competition', () => {
  // Given / When
  const result = runChecker('current', '44');

  // Then
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'clear',
    checkedOpenPullRequests: 0,
  });
});

test('mutex fails closed when GitHub lookup fails', () => {
  // Given / When
  const result = runChecker('failure');

  // Then
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), {
    status: 'error',
    reason: 'open-pr-list-failed',
  });
});
