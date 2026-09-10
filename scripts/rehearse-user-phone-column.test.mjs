import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * `scripts/rehearse-user-phone-column.sh`의 정적 계약.
 *
 * 리허설 자체는 PostgreSQL 컨테이너가 필요해 required CI가 아니라 릴리스 전에 손으로
 * 돈다(`docs/deploy/pre-deploy-verify.md` ⓪). 그래서 스크립트가 **운영 DB에 붙지 않고,
 * 뒷정리를 빠뜨리지 않으며, 추적 중인 마이그레이션 파일 그대로를 배포와 같은 트랜잭션
 * 경계에서 돌린다**는 것은 이 파일이 대신 고정한다.
 */
const rehearsal = readFileSync(
  new URL('./rehearse-user-phone-column.sh', import.meta.url),
  'utf8',
);

const migration = readFileSync(
  new URL(
    '../apps/backend/prisma/migrations/20260906174608_add_user_phone_canonical/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('rehearsal fails closed on shell errors', () => {
  assert.match(rehearsal, /^set -euo pipefail$/m);
});

test('rehearsal accepts only its two named scenarios', () => {
  // 알 수 없는 인자로 컨테이너를 띄우기 전에 멈춘다.
  assert.match(
    rehearsal,
    /\$scenario != 'migrate' && \$scenario != 'negative'/,
  );
  assert.match(
    rehearsal,
    /Usage: scripts\/rehearse-user-phone-column\.sh migrate\|negative/,
  );
});

test('rehearsal refuses non-local Docker endpoints', () => {
  // 원격 daemon을 잡으면 남의 인프라에 파괴적 DDL을 돌리게 된다.
  assert.match(
    rehearsal,
    /\[\[ "\$effective_docker_host" == unix:\/\/\* \]\] \|\|\s*\n\s*fail 'refusing a non-local Docker endpoint; only unix:\/\/ is allowed'/,
  );
  assert.ok(
    rehearsal.includes('docker context inspect'),
    'the endpoint must be resolved from the selected context, not assumed',
  );
});

test('rehearsal never reads a caller database connection', () => {
  // 호출자의 DATABASE_URL을 읽는 순간 운영 DB에 붙을 경로가 생긴다.
  assert.ok(!rehearsal.includes('DATABASE_URL'));
  assert.ok(!rehearsal.includes('POSTGRES_HOST'));
  // 호스트 포트를 열지 않으므로 컨테이너 밖에서 이 DB에 붙을 방법이 없다.
  assert.ok(
    !/docker[^\n]*\b-p\s/.test(rehearsal),
    'the rehearsal container must not publish a host port',
  );
});

test('rehearsal initializes disposable paths before the EXIT trap', () => {
  // `set -u` 아래에서 trap이 먼저 서면 미초기화 변수 참조로 정리가 죽는다.
  const trap = rehearsal.indexOf('trap cleanup EXIT');
  assert.ok(trap >= 0, 'the cleanup trap must exist');
  for (const name of ["tmp_root=''", "backup=''", 'container_started=0']) {
    const init = rehearsal.indexOf(name);
    assert.ok(init >= 0, `${name} must start empty so set -u cleanup is safe`);
    assert.ok(
      trap > init,
      `${name} must be initialized before trap cleanup EXIT`,
    );
  }
});

test('rehearsal cleanup removes the container with its volume and the tmp tree', () => {
  // 컨테이너만 지우면 익명 볼륨이 남는다 — `-v`가 그것을 함께 지운다.
  assert.match(rehearsal, /docker_cli\[@\]\}" rm -f -v "\$container"/);
  assert.match(
    rehearsal,
    /mktemp -d "\$\{TMPDIR:-\/tmp\}\/user-phone-rehearsal\.XXXXXX"/,
  );
  assert.match(rehearsal, /rm -rf -- "\$tmp_root"/);
});

test('cleanup failure fails the rehearsal even when assertions passed', () => {
  assert.match(
    rehearsal,
    /if \(\( cleanup_status != 0 \)\); then[\s\S]*?status=1/,
  );
});

test('rehearsal runs the tracked migration file, not a rewritten statement', () => {
  assert.match(
    rehearsal,
    /migrations\/20260906174608_add_user_phone_canonical\/migration\.sql/,
  );
  assert.match(rehearsal, /\[\[ -f "\$migration_sql" \]\]/);
  // 파일을 컨테이너에 넣고 그 파일을 그대로 `-f`로 실행한다.
  assert.match(
    rehearsal,
    /docker_cli\[@\]\}" cp "\$migration_sql" "\$container:\$container_migration"/,
  );
  assert.match(rehearsal, /-f "\$container_migration"/);
});

test('rehearsal reproduces the deploy transaction boundary', () => {
  // `prisma migrate deploy`는 마이그레이션 파일 하나를 한 트랜잭션으로 돌린다.
  // 문장 단위로 돌리면 DROP이 실패해도 앞의 ADD COLUMN이 커밋돼 배포와 다른 결과가 된다.
  assert.match(
    rehearsal,
    /psql_exec --single-transaction -f "\$container_migration"/,
  );
  assert.equal(
    (migration.match(/^ALTER TABLE/gm) ?? []).length,
    3,
    'this migration has three statements, so the transaction boundary is load-bearing',
  );
});

test('migrate lane proves the drop is real and the backup recovers it', () => {
  assert.match(rehearsal, /fail 'DROP left TeamMember\.phone present'/);
  assert.match(
    rehearsal,
    /fail 'restore did not recover the dropped phone values'/,
  );
  // 값이 든 복사본이 하나는 있어야 「지워졌다」와 「되돌아왔다」가 의미를 갖는다.
  assert.match(
    rehearsal,
    /fail 'fixture must contain two users and two team members with one stored phone'/,
  );
});

test('migrate lane proves the new CHECK is enforced, not just present', () => {
  assert.match(rehearsal, /phone_write_accepted '0000000000'/);
  assert.match(rehearsal, /phone_write_accepted '00000000000'/);
  assert.match(rehearsal, /phone_write_rejected '000000000'/);
  assert.match(rehearsal, /phone_write_rejected '000000000000'/);
  assert.match(rehearsal, /phone_write_rejected '0000-000-0000'/);
  // 스크립트가 기대하는 정의는 마이그레이션이 실제로 쓰는 표현과 같아야 한다.
  assert.match(
    migration,
    /CHECK \("phone" IS NULL OR "phone" ~ '\^\[0-9\]\{10,11\}\$'\)/,
  );
  assert.match(
    rehearsal,
    /User_phone_digits_check is missing or has a different definition/,
  );
});

test('negative lane requires the explicit error and a full rollback', () => {
  assert.match(
    rehearsal,
    /column "phone" of relation "TeamMember" does not exist/,
  );
  assert.match(
    rehearsal,
    /fail 'negative lane left User\.phone behind after the failed migration'/,
  );
  assert.match(
    rehearsal,
    /fail 'negative lane left the phone CHECK behind after the failed migration'/,
  );
});

test('both lanes end on a single-line JSON receipt', () => {
  for (const scenario of ['migrate', 'negative']) {
    assert.ok(
      rehearsal.includes(`"status":"ok","scenario":"${scenario}"`),
      `${scenario} must emit a machine-readable receipt`,
    );
  }
  // 성공 문자열은 정리까지 끝난 뒤에만 출력된다.
  assert.match(
    rehearsal,
    /\(\( status == 0 \)\) && \[\[ -n "\$success_result" \]\]/,
  );
});

test('rehearsal keeps synthetic phone values out of the mobile deny-list shape', () => {
  // `docs/rules/security.md`의 deny-list는 `01[016789]`로 시작하는 값을 개인정보로 본다.
  const denyList =
    /(^|[^0-9])01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}($|[^0-9])/m;
  assert.ok(
    !denyList.test(rehearsal),
    'synthetic phone fixtures must not look like real Korean mobile numbers',
  );
});
