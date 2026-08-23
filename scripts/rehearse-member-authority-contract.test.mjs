import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const rehearsal = readFileSync(
  new URL('./rehearse-member-authority-contract.sh', import.meta.url),
  'utf8',
);

test('contract rehearsal initializes disposable paths before the EXIT trap', () => {
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

test('contract rehearsal cleanup removes the container with its volumes and both tmp trees', () => {
  // 컨테이너만 지우면 익명 볼륨이 남는다 — `-v`가 그것을 함께 지운다.
  assert.match(rehearsal, /docker rm -f -v "\$container"/);
  assert.match(
    rehearsal,
    /mktemp -d "\$\{TMPDIR:-\/tmp\}\/contract-staged\.XXXXXX"/,
  );
  assert.match(
    rehearsal,
    /mktemp -d "\$\{TMPDIR:-\/tmp\}\/contract-backup\.XXXXXX"/,
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

test('contract rehearsal deploys the staged pre-contract schema without a process-substitution fallback', () => {
  // 프로세스 치환 fallback은 항상 실패하고 stderr를 삼켜 진짜 오류를 숨긴다.
  assert.doesNotMatch(rehearsal, /PRISMA_MIGRATIONS_PATH/);
  assert.doesNotMatch(rehearsal, /<\(/);
  assert.match(
    rehearsal,
    /pnpm exec prisma migrate deploy --schema "\$staged\/schema\.prisma"/,
  );
});

test('contract rehearsal seeds the 62-user fixture before any destructive DDL', () => {
  // 빈 테이블 위에서는 preflight도 NOT NULL도 아무것도 증명하지 못한다.
  assert.match(rehearsal, /member-authority-contract-62-users\.json/);
  const seed = rehearsal.indexOf('seed_fixture');
  const apply = rehearsal.indexOf('apply_contract()');
  assert.ok(seed >= 0 && apply >= 0);
  assert.match(rehearsal, /\[\[ "\$users_before" == '62' \]\]/);
});

test('contract lane proves row, id and request-status preservation', () => {
  assert.match(rehearsal, /ids_before=\$\(user_digest\)/);
  assert.match(rehearsal, /requests_before=\$\(request_digest 'RoleRequest'\)/);
  assert.match(
    rehearsal,
    /requests_after=\$\(request_digest 'StaffAccessRequest'\)/,
  );
  assert.match(rehearsal, /\[\[ "\$ids_before" == "\$ids_after" \]\]/);
  assert.match(
    rehearsal,
    /\[\[ "\$requests_before" == "\$requests_after" \]\]/,
  );
});

test('contract lane proves backup restore and previous-image rejection', () => {
  assert.match(
    rehearsal,
    /pg_dump -U migration -d contract_rehearsal --format=custom/,
  );
  assert.match(
    rehearsal,
    /pg_restore -U migration -d contract_rehearsal --no-owner/,
  );
  // 직전 이미지의 질의 모양이 계속 통하면 롤백 경계가 무너진 것이다.
  assert.match(
    rehearsal,
    /previous image query shape still resolves — rollback boundary is broken/,
  );
});

test('contract lane proves identity is never inferred from authority', () => {
  // ADMIN=>교직원 추론이 남아 있으면 학생 정체성 관리자가 0이 된다.
  assert.match(rehearsal, /student_admins=/);
  assert.match(
    rehearsal,
    /no student-identity admin survived — identity was inferred from authority/,
  );
});

test('contract-negative exercises all four abort lanes before destructive DDL', () => {
  for (const reason of [
    "assert_preflight_aborted 'an unresolved member kind on an assigned admin'",
    "assert_preflight_aborted 'a duplicated student id'",
    "assert_preflight_aborted 'a v0.6.95-era legacy role that contradicts canonical facts'",
    "assert_preflight_aborted 'a drifted (unfinished) migration ledger row'",
  ]) {
    assert.ok(
      rehearsal.includes(reason),
      `contract-negative must exercise: ${reason}`,
    );
  }
});

test('every negative lane re-proves the rollback surface survived', () => {
  // 거부된 뒤에도 legacy 칸·테이블·타입이 남아 있어야 직전 이미지로 되돌아갈 수 있다.
  assert.match(
    rehearsal,
    /User\.role was dropped despite the failed preflight/,
  );
  assert.match(
    rehearsal,
    /RoleRequest was renamed despite the failed preflight/,
  );
  assert.match(rehearsal, /Role enum was dropped despite the failed preflight/);
});
