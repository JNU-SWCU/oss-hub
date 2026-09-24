import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * `scripts/rehearse-legacy-table-drop.sh`의 정적 계약.
 *
 * 리허설 자체는 PostgreSQL 컨테이너가 필요해 required CI가 아니라 릴리스 전에 손으로
 * 돈다(`docs/deploy/pre-deploy-verify.md` ⓪). 그래서 스크립트가 **운영 DB에 직접 붙지
 * 않고, production-dump 모드에서 컨테이너 밖으로 나갈 경로가 없으며, 뒷정리를 빠뜨리지
 * 않고, 추적 중인 마이그레이션 파일 그대로를 돌린다**는 것은 이 파일이 대신 고정한다.
 */
const rehearsal = readFileSync(
  new URL('./rehearse-legacy-table-drop.sh', import.meta.url),
  'utf8',
);

const migration = readFileSync(
  new URL(
    '../apps/backend/prisma/migrations/20260924120000_drop_legacy_projection_tables/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

const composeYml = readFileSync(
  new URL('../compose.yml', import.meta.url),
  'utf8',
);

test('rehearsal fails closed on shell errors', () => {
  assert.match(rehearsal, /^set -euo pipefail$/m);
});

test('rehearsal accepts only its two named scenarios, in either mode', () => {
  assert.match(
    rehearsal,
    /\$scenario != 'migrate' && \$scenario != 'negative'/,
  );
  assert.match(
    rehearsal,
    /Usage: scripts\/rehearse-legacy-table-drop\.sh migrate\|negative \[dump_path image_tag\]/,
  );
  // 인자 개수만으로 모드를 가른다 — 두 모드가 서로 다른 옵션 파싱 표면을 갖지 않는다.
  assert.match(rehearsal, /\$# -eq 1.*\n.*mode='synthetic'/);
  assert.match(rehearsal, /\$# -eq 3.*\n.*mode='production-dump'/);
});

test('rehearsal refuses non-local Docker endpoints', () => {
  assert.match(
    rehearsal,
    /\[\[ "\$effective_docker_host" == unix:\/\/\* \]\] \|\|\s*\n\s*fail 'refusing a non-local Docker endpoint; only unix:\/\/ is allowed'/,
  );
  assert.ok(
    rehearsal.includes('docker context inspect'),
    'the endpoint must be resolved from the selected context, not assumed',
  );
});

test('rehearsal never reads a caller database connection or leaks credentials', () => {
  assert.ok(!rehearsal.includes('$DATABASE_URL'));
  assert.ok(!rehearsal.includes('POSTGRES_HOST'));
  // production-dump 모드는 release 이미지에 이 값을 절대 넘기지 않는다 — 실제 secret이
  // 담긴 `.env`가 컨테이너로 새는 유일한 경로이기 때문이다. 그 이유를 설명하는 주석
  // 자체는 이 문자열을 언급하므로, 주석이 아닌 실행 줄에는 없는지로 검사한다.
  const envFileOnExecutableLine = rehearsal
    .split('\n')
    .some(
      (line) => !line.trim().startsWith('#') && line.includes('--env-file'),
    );
  assert.ok(!envFileOnExecutableLine);
});

test('production-dump mode runs on an internal network and publishes no host port', () => {
  assert.match(rehearsal, /network create --internal "\$network"/);
  assert.match(
    rehearsal,
    /run -d --name "\$container" --network "\$network"[\s\S]*?"\$postgres_image"/,
  );
  // 같은 run 호출에 `-p`가 없어야 한다 — production-dump 컨테이너는 바깥에서 붙을 방법이
  // 없어야 하고, synthetic 모드의 `-p 127.0.0.1:0:5432`와 같은 줄에 있으면 안 된다.
  const productionRunLine = rehearsal
    .split('\n')
    .find(
      (line) =>
        line.includes('--network "$network"') && line.includes('run -d'),
    );
  assert.ok(productionRunLine, 'production-dump run invocation must exist');
  assert.ok(!productionRunLine.includes('-p '));
});

test('synthetic mode publishes only a loopback, ephemeral port', () => {
  assert.match(rehearsal, /-p 127\.0\.0\.1:0:5432/);
});

test('rehearsal initializes disposable state before the EXIT trap', () => {
  const trap = rehearsal.indexOf('trap cleanup EXIT');
  assert.ok(trap >= 0, 'the cleanup trap must exist');
  for (const name of [
    "tmp_root=''",
    "staged=''",
    'container_started=0',
    'network_created=0',
  ]) {
    const init = rehearsal.indexOf(name);
    assert.ok(init >= 0, `${name} must start empty so set -u cleanup is safe`);
    assert.ok(
      trap > init,
      `${name} must be initialized before trap cleanup EXIT`,
    );
  }
});

test('cleanup removes the container with its volume, the network, and both temp trees', () => {
  assert.match(rehearsal, /docker_cli\[@\]\}" rm -f -v "\$container"/);
  assert.match(rehearsal, /docker_cli\[@\]\}" network rm "\$network"/);
  assert.match(
    rehearsal,
    /mktemp -d "\$\{TMPDIR:-\/tmp\}\/legacy-table-drop-rehearsal\.XXXXXX"/,
  );
  assert.match(
    rehearsal,
    /mktemp -d "\$\{TMPDIR:-\/tmp\}\/legacy-table-drop-staged\.XXXXXX"/,
  );
  // 두 임시 트리 모두 정리 루프 대상이다 — staged만 빠지면 synthetic 모드가 매번 디렉터리를 흘린다.
  assert.match(rehearsal, /for dir in "\$\{tmp_root:-\}" "\$\{staged:-\}"; do/);
  assert.match(rehearsal, /rm -rf -- "\$dir"/);
});

test('cleanup shreds temp files when shred is available and never touches the input dump', () => {
  assert.match(rehearsal, /command -v shred/);
  assert.match(rehearsal, /shred -u/);
  // dump_path는 정리 루프의 두 변수(tmp_root, staged) 중 어디에도 대입되지 않는다 —
  // 읽기 전용으로만 쓰인다는 것을 코드 구조로 고정한다.
  assert.ok(!rehearsal.includes('dump_path"'.concat('\n')));
  assert.ok(!/dump_path=.*mktemp/.test(rehearsal));
  assert.ok(
    rehearsal.includes(
      'The input dump (production-dump mode) is never copied into tmp_root',
    ),
  );
});

test('cleanup failure fails the rehearsal even when assertions passed', () => {
  assert.match(
    rehearsal,
    /if \(\( cleanup_status != 0 \)\); then[\s\S]*?status=1/,
  );
});

test('rehearsal runs the tracked migration file, not a reconstructed statement', () => {
  assert.match(
    rehearsal,
    /migration_dir='20260924120000_drop_legacy_projection_tables'/,
  );
  assert.match(
    rehearsal,
    /migration_sql="\$backend\/prisma\/migrations\/\$migration_dir\/migration\.sql"/,
  );
  assert.match(rehearsal, /\[\[ -f "\$migration_sql" \]\]/);
  assert.match(rehearsal, /psql_exec <"\$migration_sql"/);
});

test('negative lane pins the gate wording directly, because Prisma only reports its last error', () => {
  // Prisma의 마지막-오류만 노출하는 습성을 설명하는 주석 — 줄바꿈으로 나뉘어 있어 부분
  // 문자열 두 개로 확인한다.
  assert.ok(rehearsal.includes('current transaction is'));
  assert.ok(rehearsal.includes('aborted'));
  assert.match(
    rehearsal,
    /gate_output" == \*'legacy tables require reconciliation'\*/,
  );
  // 실제 배포 경로(이미지 또는 로컬 prisma)는 exit code만으로 판정한다 — 메시지 내용을
  // 다시 요구하면 마스킹된 텍스트에 대해 검사가 거짓으로 실패한다.
  assert.match(
    rehearsal,
    /deploy_status != 0 \)\) \|\| fail 'migrate deploy unexpectedly succeeded/,
  );
});

test('gate message in the script matches the RAISE EXCEPTION text in the tracked migration', () => {
  assert.match(migration, /MESSAGE = 'legacy tables require reconciliation'/);
});

test('the four dropped tables and three dropped enums are hardcoded consistently with the migration', () => {
  const droppedTables = [
    'PublicShowcaseRepository',
    'PublicShowcaseContributor',
    'CollectionRun',
    'GithubRawObservation',
  ];
  const droppedEnums = [
    'ObservationSourceType',
    'CollectionRunStatus',
    'CollectionTrigger',
  ];

  for (const table of droppedTables) {
    assert.match(migration, new RegExp(`DROP TABLE "${table}"`));
    assert.ok(
      rehearsal.includes(`'${table}'`),
      `rehearsal must reference table ${table}`,
    );
  }
  for (const enumName of droppedEnums) {
    assert.match(migration, new RegExp(`DROP TYPE "${enumName}"`));
    assert.ok(
      rehearsal.includes(`'${enumName}'`),
      `rehearsal must reference enum ${enumName}`,
    );
  }
});

test('rehearsal pins the same postgres image digest compose.yml runs in production', () => {
  const composeMatch = composeYml.match(/postgres:17-alpine@sha256:[0-9a-f]+/);
  assert.ok(composeMatch, 'compose.yml must pin a postgres image digest');
  assert.match(rehearsal, new RegExp(`postgres_image='${composeMatch[0]}'`));
});

test('migrate lane proves the drop and that everything else is byte-for-byte unchanged', () => {
  assert.match(rehearsal, /fail 'DROP left one or more legacy tables behind'/);
  assert.match(
    rehearsal,
    /fail 'a constraint outside the four dropped tables changed'/,
  );
  assert.match(
    rehearsal,
    /fail 'an index outside the four dropped tables changed'/,
  );
  assert.match(
    rehearsal,
    /fail 'an enum other than the three this migration owns changed'/,
  );
  assert.match(
    rehearsal,
    /fail '_prisma_migrations did not gain exactly one row'/,
  );
  assert.match(
    rehearsal,
    /fail 'the new _prisma_migrations row is not a finished, non-rolled-back record'/,
  );
});

test('negative lane proves the gate blocks and leaves a failed, unfinished ledger row', () => {
  assert.match(rehearsal, /fail 'negative-lane fixture row did not land'/);
  assert.match(
    rehearsal,
    /fail 'negative lane dropped a legacy table despite the failed gate'/,
  );
  assert.match(
    rehearsal,
    /fail 'negative lane changed the CollectionRun fixture row'/,
  );
  assert.match(
    rehearsal,
    /fail '_prisma_migrations did not record the rejected attempt'/,
  );
  assert.match(
    rehearsal,
    /fail 'the rejected attempt was recorded as finished — the gate did not actually block it'/,
  );
});

test('snapshot helpers never select row contents, only counts and md5 hashes', () => {
  assert.doesNotMatch(rehearsal, /SELECT \*/);
  assert.match(rehearsal, /md5\(COALESCE\(/g);
});

test('both lanes end on a single-line JSON receipt, only after cleanup succeeds', () => {
  for (const scenario of ['migrate', 'negative']) {
    assert.ok(
      rehearsal.includes(`"status":"ok","scenario":"${scenario}"`),
      `${scenario} must emit a machine-readable receipt`,
    );
  }
  assert.match(
    rehearsal,
    /\(\( status == 0 \)\) && \[\[ -n "\$success_result" \]\]/,
  );
});

test('synthetic mode stages the tracked migrations tree instead of rebuilding one', () => {
  assert.match(
    rehearsal,
    /cp -R "\$backend\/prisma\/migrations" "\$staged\/migrations"/,
  );
  assert.match(
    rehearsal,
    /mv "\$staged\/migrations\/\$migration_dir" "\$staged\/pending\/\$migration_dir"/,
  );
  assert.match(
    rehearsal,
    /pnpm exec prisma migrate deploy --schema "\$staged\/schema\.prisma"/,
  );
});
