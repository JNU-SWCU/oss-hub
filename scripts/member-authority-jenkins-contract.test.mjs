import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const jenkinsfilePath = fileURLToPath(
  new URL('../Jenkinsfile', import.meta.url),
);
const source = readFileSync(jenkinsfilePath, 'utf8');
const backendDockerfile = readFileSync(
  fileURLToPath(new URL('../apps/backend/Dockerfile', import.meta.url)),
  'utf8',
);

function stageOffset(contents, name) {
  return contents.indexOf(`stage('${name}')`);
}

function validate(contents) {
  const backup = stageOffset(contents, 'PostgreSQL 기동 및 배포 전 백업');
  const backfill = stageOffset(contents, '회원 권한 backfill');
  const replacement = stageOffset(contents, '서비스 교체 및 스모크 확인');
  assert.ok(backup >= 0);
  assert.ok(backfill > backup);
  assert.ok(replacement > backfill);
  assert.equal(
    contents.match(/member-authority-backfill\.js --apply-production/g)?.length,
    1,
  );
  assert.match(contents, /prisma-migration-ledger\.mjs prisma\/migrations/);
  assert.ok(
    contents.indexOf('prisma-migration-ledger.mjs prisma/migrations') <
      contents.indexOf('member-authority-backfill.js --apply-production'),
  );
  assert.match(contents, /member-authority-backfill\.js --status-production/);
  assert.match(contents, /verify-member-authority-backfill\.mjs/);
}

test('candidate backend image carries the shared Prisma ledger verifier', () => {
  assert.match(
    backendDockerfile,
    /COPY --chown=node:node scripts\/prisma-migration-ledger\.mjs \.\/scripts\/prisma-migration-ledger\.mjs/,
  );
});

test('Jenkins captures a fresh aggregate and runs one versioned backfill before replacement', () => {
  // Given / When / Then
  validate(source);
});

test('Jenkins contract rejects a missing migration-ledger preflight', () => {
  // Given
  const withoutLedger = source.replace(
    /docker run --rm \\\n  --network "\$\{COMPOSE_PROJECT_NAME\}_default" \\\n  --env-file "\$OSS_HUB_ENV_FILE" \\\n  "oss-hub-backend:\$\{IMAGE_TAG\}" \\\n  node scripts\/prisma-migration-ledger\.mjs prisma\/migrations \\\n  >"\$backfill_tmp\/ledger\.json"\n\n/,
    '',
  );

  // When / Then
  assert.throws(() => validate(withoutLedger));
});

test('Jenkins contract rejects a duplicate production backfill invocation', () => {
  // Given
  const duplicate = source.replace(
    'node dist/prisma/member-authority-backfill.js --apply-production --evidence -',
    'node dist/prisma/member-authority-backfill.js --apply-production --evidence -\nnode dist/prisma/member-authority-backfill.js --apply-production',
  );

  // When / Then
  assert.throws(() => validate(duplicate));
});

test('Jenkins contract rejects a backfill stage after service replacement', () => {
  // Given
  const reordered = source
    .replace("stage('회원 권한 backfill')", "stage('temporary-backfill')")
    .replace(
      "stage('서비스 교체 및 스모크 확인')",
      "stage('회원 권한 backfill')",
    );

  // When / Then
  assert.throws(() => validate(reordered));
});
