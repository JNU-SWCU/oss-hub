import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const rehearsal = readFileSync(
  new URL('./rehearse-legacy-submission-migrations.sh', import.meta.url),
  'utf8',
);
const fixture = readFileSync(
  new URL(
    '../apps/backend/prisma/fixtures/legacy-submission-rehearsal.sql',
    import.meta.url,
  ),
  'utf8',
);

/**
 * contract 마이그레이션이 파괴적 DDL 앞에 세운 preflight 게이트 아홉 개.
 * 문구는 `20260830180000_contract_legacy_submissions/migration.sql`의 RAISE 메시지 원문이다.
 */
const GATES = [
  'legacy submission source orphan requires reconciliation',
  'legacy submission current revision requires reconciliation',
  'legacy submission deterministic target id collision requires reconciliation',
  'legacy submission public id collision requires reconciliation',
  'legacy submission header mapping requires reconciliation',
  'legacy submission revision mapping requires reconciliation',
  'legacy review mapping requires reconciliation',
  'legacy submission file provenance requires reconciliation',
  'legacy seed file target provenance requires reconciliation',
];

test('rehearsal initializes disposable paths before the EXIT trap', () => {
  // Given — `set -u` 아래에서 trap이 먼저 서면 미초기화 변수 참조로 정리가 죽는다.
  const trap = rehearsal.indexOf('trap cleanup EXIT');
  for (const name of ["staged=''", "backup=''", "port=''"]) {
    const init = rehearsal.indexOf(name);
    assert.ok(init >= 0, `${name} must start empty so set -u cleanup is safe`);
    assert.ok(
      trap > init,
      `${name} must be initialized before trap cleanup EXIT`,
    );
  }
});

test('rehearsal cleanup removes the container with its volumes and both tmp trees', () => {
  // 컨테이너만 지우면 익명 볼륨이 남는다 — `-v`가 그것을 함께 지운다.
  assert.match(rehearsal, /docker rm -f -v "\$container"/);
  assert.match(
    rehearsal,
    /mktemp -d "\$\{TMPDIR:-\/tmp\}\/legacy-submission-staged\.XXXXXX"/,
  );
  assert.match(
    rehearsal,
    /mktemp -d "\$\{TMPDIR:-\/tmp\}\/legacy-submission-backup\.XXXXXX"/,
  );
  assert.match(
    rehearsal,
    /if \[\[ -n \$\{staged:-\} \]\]; then\s+rm -rf -- "\$staged"/s,
  );
  assert.match(
    rehearsal,
    /if \[\[ -n \$\{backup:-\} \]\]; then\s+rm -rf -- "\$backup"/s,
  );
});

test('rehearsal owns a disposable database and never reads an ambient DATABASE_URL', () => {
  // 운영·개발 DB에 붙을 수 있는 유일한 경로는 호출자가 넘긴 DATABASE_URL이다.
  assert.doesNotMatch(rehearsal, /\$\{?DATABASE_URL:-/);
  assert.match(rehearsal, /-p 0:5432 postgres:17-alpine/);
});

test('rehearsal database is not named oss_hub_test so the bridge fences stay live', () => {
  // bridge가 심는 두 트리거는 `current_database() = 'oss_hub_test'`에서 스스로 비켜선다.
  // 그 이름을 쓰면 fence가 꺼진 채로 도는 리허설이 되어 아무것도 증명하지 못한다.
  assert.doesNotMatch(rehearsal, /POSTGRES_DB=oss_hub_test/);
  assert.match(rehearsal, /POSTGRES_DB=legacy_submission_rehearsal/);
  assert.match(rehearsal, /database='legacy_submission_rehearsal'/);
});

test('rehearsal stages the three migrations one stage at a time', () => {
  // 세 단계를 한 번의 deploy로 몰면 bridge와 contract 사이에 데이터를 흔들 자리가 없어
  // preflight 게이트를 하나도 겨눌 수 없다.
  assert.doesNotMatch(rehearsal, /PRISMA_MIGRATIONS_PATH/);
  assert.doesNotMatch(rehearsal, /<\(/);
  assert.match(
    rehearsal,
    /pnpm exec prisma migrate deploy --schema "\$staged\/schema\.prisma"/,
  );
  for (const stage of [
    '20260830050000_expand_legacy_submission_bridge',
    '20260830100000_bridge_legacy_submissions',
    '20260830180000_contract_legacy_submissions',
  ]) {
    assert.ok(rehearsal.includes(stage), `rehearsal must stage ${stage}`);
  }
});

test('rehearsal seeds the source fixture before any destructive DDL', () => {
  // 빈 데이터베이스 위에서는 preflight도 bridge 복사도 아무것도 증명하지 못한다.
  assert.match(rehearsal, /legacy-submission-rehearsal\.sql/);
  const seed = rehearsal.indexOf('\nseed_fixture\n');
  const contract = rehearsal.indexOf('stage "$contract_dir"');
  assert.ok(seed >= 0 && contract >= 0);
  assert.ok(
    seed < contract,
    'the fixture must be seeded before contract is staged',
  );
});

test('the fixture carries both reserved seed graphs and production-shaped graphs', () => {
  // 게이트 아홉 개는 `seed:` 예약 접두사 유무로 갈린다 — 둘 다 없으면 절반은 잠들어 있다.
  assert.match(fixture, /'seed:/);
  assert.match(fixture, /synthetic/);
  // 다중 revision과 review가 없으면 이력 매핑 게이트가 볼 것이 없다.
  assert.match(fixture, /INSERT INTO "SubmissionRevision"/);
  assert.match(fixture, /INSERT INTO "Review"/);
  assert.match(fixture, /INSERT INTO "SubmissionFile"/);
});

test('migrate lane compares row counts and the id mapping across the migration', () => {
  assert.match(rehearsal, /submissions_before=/);
  assert.match(rehearsal, /revisions_before=/);
  assert.match(rehearsal, /reviews_before=/);
  assert.match(rehearsal, /mapping_before=/);
  assert.match(rehearsal, /mapping_after=/);
  assert.match(
    rehearsal,
    /expect_equal 'header mapping' "\$mapping_before" "\$mapping_after"/,
  );
  assert.match(
    rehearsal,
    /expect_equal 'revision mapping' "\$history_before" "\$history_after"/,
  );
  assert.match(
    rehearsal,
    /expect_equal 'review mapping' "\$review_before" "\$review_after"/,
  );
});

test('migrate lane proves the three source tables are gone and control rows are untouched', () => {
  for (const table of ['Review', 'SubmissionRevision', 'Submission']) {
    assert.ok(
      rehearsal.includes(`'${table}'`),
      `migrate lane must assert the ${table} table is gone`,
    );
  }
  assert.match(rehearsal, /control_before/);
  assert.match(rehearsal, /control_after/);
});

test('migrate lane proves the bridge write fence is live before contract', () => {
  // fence가 꺼져 있으면 bridge 이후 원본이 계속 갈라져도 아무도 모른다.
  assert.match(rehearsal, /legacy submission source is read only after bridge/);
});

test('migrate lane proves the pre-contract backup restores the dropped tables', () => {
  // Prisma에는 down 마이그레이션이 없다 — 이 백업이 되돌릴 유일한 근거다.
  assert.match(
    rehearsal,
    /pg_dump -U migration -d legacy_submission_rehearsal --format=custom/,
  );
  assert.match(
    rehearsal,
    /pg_restore -U migration -d legacy_submission_rehearsal --no-owner/,
  );
});

test('negative lane names all nine preflight gates by their own message', () => {
  // 어느 게이트가 걸렸는지 문구로 확인하지 않으면 "게이트 하나가 걸렸다"만 알 뿐
  // 아홉 개 각각이 살아 있다는 증거가 되지 못한다.
  for (const gate of GATES) {
    assert.ok(
      rehearsal.includes(gate),
      `negative lane must target the gate: ${gate}`,
    );
  }
  assert.match(rehearsal, /assert_preflight_aborted /);
});

test('every negative lane restores the post-bridge snapshot before perturbing', () => {
  // 앞 레인의 위반이 남아 있으면 그 게이트가 먼저 걸려 뒤 게이트는 검증되지 않는다.
  assert.match(rehearsal, /restore_post_bridge/);
});

test('every negative lane re-proves the rollback surface survived the abort', () => {
  // 거부된 뒤에도 세 테이블과 source FK 칸이 남아 있어야 직전 이미지로 되돌아갈 수 있다.
  assert.match(
    rehearsal,
    /for surviving in 'Submission' 'SubmissionRevision' 'Review'/,
  );
  assert.match(rehearsal, /was dropped despite the failed preflight/);
  assert.match(
    rehearsal,
    /SubmissionFile\.\\"submissionRevisionId\\" was dropped despite the failed preflight/,
  );
});
