import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const checkerPath = fileURLToPath(
  new URL('./check-member-authority-production.sh', import.meta.url),
);
const root = mkdtempSync(join(tmpdir(), 'member-authority-checker-'));
const bin = join(root, 'bin');
const envFile = join(root, 'synthetic-production.env');
const tag = 'v0.7.0';
const sha = 'a'.repeat(40);

mkdirSync(bin);
writeFileSync(envFile, 'SYNTHETIC_ONLY=true\n');
writeExecutable(
  'curl',
  '#!/usr/bin/env bash\nset -euo pipefail\n[[ "$*" == *"/api/v1/health"* ]]\n',
);
writeExecutable(
  'docker',
  `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == compose ]]; then
  [[ "$2" == --env-file && -n "$3" ]]
  shift 3
  case "$*" in
    "ps -q frontend") printf 'frontend-container\\n' ;;
    "ps -q backend") printf 'backend-container\\n' ;;
    exec*prisma-migration-ledger*) printf '%s\\n' "$LEDGER_JSON"; exit "$LEDGER_EXIT" ;;
    exec*member-authority-backfill*) printf '%s\\n' "$AGGREGATE_JSON" ;;
    *) printf 'unexpected compose command\\n' >&2; exit 1 ;;
  esac
  exit 0
fi
case "$*" in
  inspect*frontend-container) printf 'oss-hub-frontend:%s|%s|%s|sha256:frontend|running|healthy\\n' "$FIXTURE_TAG" "$FIXTURE_TAG" "$FIXTURE_SHA" ;;
  inspect*backend-container) printf 'oss-hub-backend:%s|%s|%s|sha256:backend|running|healthy\\n' "$FIXTURE_TAG" "$FIXTURE_TAG" "$FIXTURE_SHA" ;;
  "image inspect --format {{.Id}} oss-hub-frontend:$FIXTURE_TAG") printf 'sha256:frontend\\n' ;;
  "image inspect --format {{.Id}} oss-hub-backend:$FIXTURE_TAG") printf 'sha256:backend\\n' ;;
  *) printf 'unexpected docker command\\n' >&2; exit 1 ;;
esac
`,
);

after(() => rmSync(root, { recursive: true, force: true }));

test('status uses the explicit env file and writes aggregate-only evidence', () => {
  const output = join(root, 'status.json');
  const result = runChecker('status', output, aggregate(5, 5));

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.release.tag, tag);
  assert.equal(report.release.sha, sha);
  assert.equal(report.images.frontend.imageId, 'sha256:frontend');
  assert.deepEqual(report.prismaLedger, { status: 'ok', migrationCount: 51 });
  assert.equal(report.aggregate.users, 62);
  assert.equal(report.readyForCutover, false);
  assert.equal('rows' in report, false);
});

test('ready-for-cutover requires both zero gates', () => {
  const blockedOutput = join(root, 'not-ready.json');
  const blocked = runChecker(
    'ready-for-cutover',
    blockedOutput,
    aggregate(1, 0),
  );
  assert.equal(blocked.status, 1);
  assert.equal(
    JSON.parse(readFileSync(blockedOutput, 'utf8')).readyForCutover,
    false,
  );

  const readyOutput = join(root, 'ready.json');
  const ready = runChecker('ready-for-cutover', readyOutput, aggregate(0, 0));
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(
    JSON.parse(readFileSync(readyOutput, 'utf8')).readyForCutover,
    true,
  );
});

test('missing or empty explicit env files fail closed without leaking paths', () => {
  const missing = join(root, 'synthetic-missing.env');
  const missingResult = runChecker(
    'status',
    join(root, 'missing-env.json'),
    aggregate(0, 0),
    { envPath: missing },
  );
  assert.equal(missingResult.status, 1);
  assert.doesNotMatch(missingResult.stderr, new RegExp(missing));

  const empty = join(root, 'synthetic-empty.env');
  writeFileSync(empty, '');
  const emptyResult = runChecker(
    'status',
    join(root, 'empty-env.json'),
    aggregate(0, 0),
    { envPath: empty },
  );
  assert.equal(emptyResult.status, 1);
  assert.doesNotMatch(emptyResult.stderr, new RegExp(empty));

  const unreadable = join(root, 'synthetic-unreadable.env');
  writeFileSync(unreadable, 'SYNTHETIC_ONLY=true\n');
  chmodSync(unreadable, 0o000);
  const unreadableResult = runChecker(
    'status',
    join(root, 'unreadable-env.json'),
    aggregate(0, 0),
    { envPath: unreadable },
  );
  chmodSync(unreadable, 0o600);
  assert.equal(unreadableResult.status, 1);
  assert.doesNotMatch(unreadableResult.stderr, new RegExp(unreadable));
});

test('malformed, missing, or rejected migration ledger receipts fail closed', () => {
  const malformed = runChecker(
    'status',
    join(root, 'malformed-ledger.json'),
    aggregate(0, 0),
    { ledgerJson: '{' },
  );
  assert.equal(malformed.status, 1);

  const missing = runChecker(
    'status',
    join(root, 'missing-ledger.json'),
    aggregate(0, 0),
    { ledgerJson: '{}' },
  );
  assert.equal(missing.status, 1);

  const unexpected = runChecker(
    'status',
    join(root, 'unexpected-ledger.json'),
    aggregate(0, 0),
    {
      ledgerJson: JSON.stringify({
        status: 'rejected',
        issues: ['unexpected:synthetic_migration'],
      }),
      ledgerExit: '1',
    },
  );
  assert.equal(unexpected.status, 1);
});

test('wrong backfill version or image identity fails before evidence', () => {
  const wrongVersion = aggregate(0, 0);
  wrongVersion.version = 'unexpected-version';
  assert.equal(
    runChecker('status', join(root, 'wrong-version.json'), wrongVersion).status,
    1,
  );
  assert.equal(
    runChecker('status', join(root, 'wrong-image.json'), aggregate(0, 0), {
      requestedTag: 'v0.7.1',
    }).status,
    1,
  );
});

test('strict arguments reject unknown mode and non-HTTPS URL', () => {
  const unknown = spawnSync(checkerPath, ['unknown'], { encoding: 'utf8' });
  const insecure = spawnSync(
    checkerPath,
    ['status', tag, sha, 'http://public.test', join(root, 'insecure.json')],
    { encoding: 'utf8' },
  );
  assert.equal(unknown.status, 2);
  assert.equal(insecure.status, 2);
});

function runChecker(
  mode,
  output,
  aggregateJson,
  {
    requestedTag = tag,
    envPath = envFile,
    ledgerJson = JSON.stringify({ status: 'ok', migrationCount: 51 }),
    ledgerExit = '0',
  } = {},
) {
  return spawnSync(
    checkerPath,
    [mode, requestedTag, sha, 'https://public.test', output],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        OSS_HUB_ENV_FILE: envPath,
        FIXTURE_TAG: tag,
        FIXTURE_SHA: sha,
        AGGREGATE_JSON: JSON.stringify(aggregateJson),
        LEDGER_JSON: ledgerJson,
        LEDGER_EXIT: ledgerExit,
      },
    },
  );
}

function aggregate(unresolved, compatibilityOnly) {
  return {
    version: '20260821-member-authority-v1',
    aggregate: {
      users: 62,
      profiles: 60,
      requests: 4,
      legacyRoles: { STUDENT: 52, STAFF: 3, ADMIN: 5, UNASSIGNED: 2 },
      memberKinds: {
        STUDENT: 52,
        STAFF: 3,
        UNRESOLVED_ASSIGNED: unresolved,
      },
      selectedMemberKinds: { STUDENT: 54, STAFF: 3, UNRESOLVED: 5 },
      unassignedMemberKinds: { STUDENT: 0, STAFF: 0, UNRESOLVED: 2 },
      backfillTargets: {
        memberKinds: { STUDENT: 0, STAFF: 0 },
        selectedMemberKinds: { STUDENT: 0, STAFF: 0 },
      },
      requestStatuses: { PENDING: 0, APPROVED: 4, REJECTED: 0, REVOKED: 0 },
      requestHistoryHash: 'b'.repeat(64),
      staffAccess: 8,
      adminAccess: 5,
      compatibilityOnlyAdminAuthorities: compatibilityOnly,
    },
  };
}

function writeExecutable(name, contents) {
  const path = join(bin, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}
