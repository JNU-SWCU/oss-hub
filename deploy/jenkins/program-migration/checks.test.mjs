import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const POSTGRES_IMAGE = 'postgres:17-alpine';
const DB_USER = 'pm_fixture';
const DB_SECRET = 'SENTINEL-DB-PASSWORD-7f3a';
const STORAGE_SECRET = 'SENTINEL-STORAGE-SECRET-91bc';
const HEAD = '20261103000000_fixture_head';
const LONG = { timeout: 180_000 };
const container = `pm-checks-${process.pid}-${Date.now()}`;
let root;
let dump;
let scenario = 0;
let databases = 0;

function docker(...args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 60_000,
  });
  return result;
}

function sql(database, statement) {
  const result = docker(
    'exec',
    container,
    'psql',
    '-X',
    '-q',
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    DB_USER,
    '-d',
    database,
    '-c',
    statement,
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function run(script, args, env = {}, path) {
  const result = spawnSync('bash', [join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      PATH: path ? `${path}:${process.env.PATH}` : process.env.PATH,
      PM_PG_CONTAINER: container,
      R2_STORAGE_SECRET_ACCESS_KEY: STORAGE_SECRET,
      ...env,
    },
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.ok(!output.includes(DB_SECRET), 'database secret leaked');
  assert.ok(!output.includes(STORAGE_SECRET), 'storage secret leaked');
  return { status: result.status, output };
}

function workspace() {
  scenario += 1;
  const dir = join(root, `scenario-${scenario}`);
  mkdirSync(dir);
  return dir;
}

function writeFiles(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    writeFileSync(path, content);
    if (name.endsWith('.sh')) chmodSync(path, 0o755);
  }
}

function createDatabase(statements = '') {
  databases += 1;
  const name = `fixture_${databases}`;
  sql('postgres', `CREATE DATABASE ${name}`);
  if (statements) sql(name, statements);
  return name;
}

function checksManifest(dir, checks) {
  writeFiles(dir, {
    'noop.sql': 'SELECT 0;\n',
    'count.sql': 'SELECT 1;\n',
  });
  const manifest = join(dir, 'manifest.json');
  writeFileSync(
    manifest,
    JSON.stringify({
      version: 1,
      name: 'fixture',
      expectedHeadMigration: HEAD,
      preflight: checks,
      stages: [{ id: 'only', apply: [], reconcile: checks }],
      backupBeforeStage: 'only',
      counts: [{ name: 'rows', file: 'count.sql' }],
    }),
  );
  return manifest;
}

function stubBin(dir, dockerBody) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\n${dockerBody}\n`);
  chmodSync(join(bin, 'docker'), 0o755);
  return bin;
}

const OLD_NEW_DIFF = `SELECT count(*) FROM (
  (SELECT * FROM "Application" EXCEPT SELECT * FROM "Team")
  UNION ALL
  (SELECT * FROM "Team" EXCEPT SELECT * FROM "Application")
) mismatch;
`;

function rehearsalManifest(dir, overrides = {}) {
  writeFiles(dir, {
    'preflight.sql':
      'SELECT count(*) FROM "Application" WHERE answer IS NULL;\n',
    'copy.sql':
      'CREATE TABLE "Team" (LIKE "Application"); INSERT INTO "Team" SELECT * FROM "Application";\n',
    'reconcile-copy.sql': OLD_NEW_DIFF,
    'write.sql': `INSERT INTO "Team" VALUES (3, 'after-cutover'); INSERT INTO "Application" VALUES (3, 'after-cutover');\n`,
    'reconcile-old.sql': `SELECT (SELECT count(*) FROM "Application" WHERE id = 3 AND answer = 'after-cutover') * -1 + 1 + (${OLD_NEW_DIFF.trim().replace(/;$/, '')});\n`,
    'previous-image.sh': `#!/bin/sh
printf '%s\\n' "$R2_STORAGE_SECRET_ACCESS_KEY"
found="$(docker exec "$PM_PG_CONTAINER" psql -X -At -U ${DB_USER} -d "$PM_DATABASE" -c 'SELECT count(*) FROM "Application" WHERE id = 3')"
test "$found" = 1
`,
    'drop.sql': 'DROP TABLE "Application";\n',
    'reconcile-drop.sql': `SELECT CASE WHEN to_regclass('public."Application"') IS NULL THEN 0 ELSE 1 END;\n`,
    'count-applications.sql': 'SELECT count(*) FROM "Application";\n',
    'count-files.sql': 'SELECT count(*) FROM "File";\n',
    'mirror.sh': `#!/bin/sh
printf '%s\\n' "$R2_STORAGE_SECRET_ACCESS_KEY"
for target; do :; done
printf 'object-one' > "$target/one"
mkdir "$target/nested"
printf 'object-two' > "$target/nested/two"
`,
  });
  const manifest = join(dir, 'manifest.json');
  writeFileSync(
    manifest,
    JSON.stringify({
      version: 1,
      name: 'fixture-rehearsal',
      expectedHeadMigration: HEAD,
      preflight: ['preflight.sql'],
      stages: [
        { id: 'copy', apply: ['copy.sql'], reconcile: ['reconcile-copy.sql'] },
        { id: 'switch-read', apply: [], reconcile: ['reconcile-copy.sql'] },
        {
          id: 'drop-old',
          apply: ['drop.sql'],
          reconcile: ['reconcile-drop.sql'],
        },
      ],
      cutover: {
        afterStage: 'switch-read',
        write: ['write.sql'],
        previousImageCheck: ['./previous-image.sh'],
        oldStructureReconcile: ['reconcile-old.sql'],
      },
      backupBeforeStage: 'drop-old',
      counts: [
        { name: 'application-rows', file: 'count-applications.sql' },
        { name: 'file-rows', file: 'count-files.sql' },
      ],
      objectMirror: ['./mirror.sh'],
      ...overrides,
    }),
  );
  return manifest;
}

function rehearse(manifest, env = {}, path) {
  return run('rehearse.sh', [manifest], { PM_DUMP_FILE: dump, ...env }, path);
}

function rehearsalDatabases() {
  return sql(
    'postgres',
    `SELECT count(*) FROM pg_database WHERE datname LIKE 'pm\\_rehearsal\\_%'`,
  );
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'program-migration-'));
  const started = docker(
    'run',
    '-d',
    '--rm',
    '--name',
    container,
    '--label',
    'oss-hub.program-migration.rehearsal=true',
    '--tmpfs',
    '/var/lib/postgresql/data',
    '-e',
    `POSTGRES_USER=${DB_USER}`,
    '-e',
    `POSTGRES_PASSWORD=${DB_SECRET}`,
    '-e',
    'POSTGRES_DB=fixture_source',
    POSTGRES_IMAGE,
  );
  assert.equal(started.status, 0, started.stderr);
  const ready = spawnSync(
    'docker',
    [
      'exec',
      container,
      'sh',
      '-c',
      `until pg_isready -q -h 127.0.0.1 -U ${DB_USER} -d fixture_source; do sleep 0.2; done`,
    ],
    { timeout: 60_000 },
  );
  assert.equal(ready.status, 0, 'postgres did not become ready');
  sql(
    'fixture_source',
    `CREATE TABLE _prisma_migrations (
       id text PRIMARY KEY, migration_name text NOT NULL,
       finished_at timestamptz, rolled_back_at timestamptz);
     INSERT INTO _prisma_migrations VALUES ('1', '${HEAD}', now(), NULL);
     CREATE TABLE "Application" (id int PRIMARY KEY, answer text);
     INSERT INTO "Application" VALUES (1, 'one'), (2, 'two');
     CREATE TABLE "File" (id int PRIMARY KEY, storage_key text);
     INSERT INTO "File" VALUES (1, 'one'), (2, 'nested/two');`,
  );
  dump = join(root, 'source-dump.sql');
  const fd = openSync(dump, 'w');
  const dumped = spawnSync(
    'docker',
    ['exec', container, 'pg_dump', '-U', DB_USER, '-d', 'fixture_source'],
    { stdio: ['ignore', fd, 'pipe'], timeout: 60_000 },
  );
  closeSync(fd);
  assert.equal(dumped.status, 0, String(dumped.stderr));
}, LONG);

after(() => {
  docker('rm', '-f', container);
  rmSync(root, { recursive: true, force: true });
}, LONG);

test('일치 픽스처는 대조를 통과한다', LONG, () => {
  const dir = workspace();
  writeFiles(dir, { 'diff.sql': OLD_NEW_DIFF });
  const database = createDatabase(
    `CREATE TABLE "Application" (id int, answer text);
     CREATE TABLE "Team" (id int, answer text);
     INSERT INTO "Application" VALUES (1, 'a');
     INSERT INTO "Team" VALUES (1, 'a');`,
  );
  const result = run(
    'reconcile.sh',
    [checksManifest(dir, ['diff.sql']), 'only'],
    {
      PM_DATABASE: database,
    },
  );
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /RECONCILE_OK stage=only checks=1/);
});

test('불일치 픽스처는 건수를 보고하고 실패한다', LONG, () => {
  const dir = workspace();
  writeFiles(dir, { 'diff.sql': OLD_NEW_DIFF });
  const database = createDatabase(
    `CREATE TABLE "Application" (id int, answer text);
     CREATE TABLE "Team" (id int, answer text);
     INSERT INTO "Application" VALUES (1, 'a');
     INSERT INTO "Team" VALUES (1, 'b');`,
  );
  const result = run(
    'reconcile.sh',
    [checksManifest(dir, ['diff.sql']), 'only'],
    {
      PM_DATABASE: database,
    },
  );
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /mismatches=2/);
  assert.doesNotMatch(result.output, /RECONCILE_OK/);
});

for (const [name, body] of [
  ['빈 파일', ''],
  ['결과 없는 문장', 'CREATE TEMP TABLE t (id int);\n'],
  ['정수가 아닌 출력', "SELECT 'ok';\n"],
  ['두 줄 출력', 'SELECT 0; SELECT 0;\n'],
  ['앞 문장 오류 뒤 성공', 'SELECT no_such_column; SELECT 0;\n'],
  ['읽기 전용 위반', 'CREATE TABLE written (id int); SELECT 0;\n'],
  [
    'RAISE EXCEPTION',
    "DO $$ BEGIN RAISE EXCEPTION 'conflict'; END $$; SELECT 0;\n",
  ],
]) {
  test(`부분 실패는 exit 0이 아니다: ${name}`, LONG, () => {
    const dir = workspace();
    writeFiles(dir, {
      'first.sql': 'SELECT 0;\n',
      'broken.sql': body,
      'last.sql': 'SELECT 0;\n',
    });
    const manifest = checksManifest(dir, [
      'first.sql',
      'broken.sql',
      'last.sql',
    ]);
    const result = run('reconcile.sh', [manifest, 'only']);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /CHECKS_FAILED 1 of 3/);
    assert.match(result.output, /CHECK_OK .*last\.sql/);
    assert.doesNotMatch(result.output, /RECONCILE_OK/);
  });
}

test('SQL 오류의 행 값은 로그에 남지 않는다', LONG, () => {
  const dir = workspace();
  writeFiles(dir, {
    'pii.sql': `CREATE TEMP TABLE t (email text UNIQUE);
      INSERT INTO t VALUES ('pii@example.test'), ('pii@example.test');
      SELECT 0;\n`,
  });
  const result = run('reconcile.sh', [
    checksManifest(dir, ['pii.sql']),
    'only',
  ]);
  assert.equal(result.status, 1, result.output);
  assert.doesNotMatch(result.output, /pii@example\.test/);
});

test('느린 쿼리는 statement timeout으로 실패한다', LONG, () => {
  const dir = workspace();
  writeFiles(dir, { 'slow.sql': 'SELECT pg_sleep(30), 0;\n' });
  const started = Date.now();
  const result = run(
    'reconcile.sh',
    [checksManifest(dir, ['slow.sql']), 'only'],
    {
      PM_STATEMENT_TIMEOUT_MS: '500',
    },
  );
  assert.equal(result.status, 1, result.output);
  assert.ok(Date.now() - started < 20_000);
});

test(
  '멈춘 psql은 명령 시간 제한으로 끝나고 컨테이너에 남지 않는다',
  LONG,
  () => {
    const dir = workspace();
    writeFiles(dir, { 'slow.sql': 'SELECT pg_sleep(30), 0;\n' });
    const started = Date.now();
    const result = run(
      'reconcile.sh',
      [checksManifest(dir, ['slow.sql']), 'only'],
      {
        PM_STATEMENT_TIMEOUT_MS: '60000',
        PM_CHECK_TIMEOUT: '1',
      },
    );
    assert.equal(result.status, 1, result.output);
    assert.ok(Date.now() - started < 20_000);
    const remaining = docker(
      'exec',
      container,
      'sh',
      '-c',
      'pgrep -x psql | wc -l',
    );
    assert.equal(remaining.stdout.trim(), '0');
  },
);

test('멈춘 docker 클라이언트는 시간 제한으로 실패한다', LONG, () => {
  const dir = workspace();
  const bin = stubBin(dir, 'exec sleep 60');
  writeFiles(dir, { 'ok.sql': 'SELECT 0;\n' });
  const started = Date.now();
  const result = run(
    'reconcile.sh',
    [checksManifest(dir, ['ok.sql']), 'only'],
    { PM_CHECK_TIMEOUT: '1' },
    bin,
  );
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /timed out/);
  assert.ok(Date.now() - started < 20_000);
});

test('사전 점검은 기대한 원장 머리에서만 통과한다', LONG, () => {
  const dir = workspace();
  writeFiles(dir, { 'ok.sql': 'SELECT 0;\n' });
  const manifest = checksManifest(dir, ['ok.sql']);
  const passed = run('preflight.sh', [manifest]);
  assert.equal(passed.status, 0, passed.output);
  assert.match(passed.output, new RegExp(`PREFLIGHT_OK head=${HEAD} checks=1`));

  const ledger = `CREATE TABLE _prisma_migrations (
    id text PRIMARY KEY, migration_name text NOT NULL,
    finished_at timestamptz, rolled_back_at timestamptz);`;
  const stale = createDatabase(
    `${ledger} INSERT INTO _prisma_migrations VALUES ('1', '20261001000000_stale', now(), NULL);`,
  );
  const staleResult = run('preflight.sh', [manifest], { PM_DATABASE: stale });
  assert.equal(staleResult.status, 1, staleResult.output);
  assert.match(staleResult.output, /ledger mismatch/);

  const unfinished = createDatabase(
    `${ledger} INSERT INTO _prisma_migrations VALUES
       ('1', '${HEAD}', now(), NULL), ('2', '20261104000000_failed', NULL, NULL);`,
  );
  const unfinishedResult = run('preflight.sh', [manifest], {
    PM_DATABASE: unfinished,
  });
  assert.equal(unfinishedResult.status, 1, unfinishedResult.output);

  const missing = createDatabase();
  const missingResult = run('preflight.sh', [manifest], {
    PM_DATABASE: missing,
  });
  assert.equal(missingResult.status, 1, missingResult.output);
});

test('잘못된 매니페스트는 DB에 닿기 전에 거부한다', LONG, () => {
  const dir = workspace();
  const bin = stubBin(dir, 'exit 99');
  writeFiles(dir, { 'ok.sql': 'SELECT 0;\n' });
  const base = JSON.parse(
    readFileSync(checksManifest(dir, ['ok.sql']), 'utf8'),
  );
  for (const [name, broken] of [
    ['typo', { ...base, reconcil: [] }],
    ['empty-preflight', { ...base, preflight: [] }],
    ['missing-file', { ...base, preflight: ['nope.sql'] }],
    [
      'empty-reconcile',
      { ...base, stages: [{ id: 'only', apply: [], reconcile: [] }] },
    ],
    ['no-counts', { ...base, counts: [] }],
    ['bad-backup-stage', { ...base, backupBeforeStage: 'nope' }],
    [
      'cutover-after-backup',
      {
        ...base,
        cutover: {
          afterStage: 'only',
          write: ['ok.sql'],
          previousImageCheck: ['true'],
          oldStructureReconcile: ['ok.sql'],
        },
      },
    ],
  ]) {
    const manifest = join(dir, `${name}.json`);
    writeFileSync(manifest, JSON.stringify(broken));
    const result = run('preflight.sh', [manifest], {}, bin);
    assert.equal(result.status, 1, `${name}: ${result.output}`);
    assert.match(result.output, /FAIL_CLOSED manifest/, name);
  }
});

test('백업은 덤프, 객체, 영수증을 만들고 재검증을 통과한다', LONG, () => {
  const dir = workspace();
  rehearsalManifest(dir);
  const backups = join(dir, 'backups');
  const result = run('backup.sh', [
    '--label',
    'release-1',
    '--backup-dir',
    backups,
    '--',
    join(dir, 'mirror.sh'),
  ]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /BACKUP_OK label=release-1 .*object-count=2/);
  assert.deepEqual(readdirSync(backups).sort(), [
    'release-1.objects',
    'release-1.objects.sha256',
    'release-1.receipt',
    'release-1.sql',
  ]);
  const verified = run('verify-backup.sh', [backups, 'release-1']);
  assert.equal(verified.status, 0, verified.output);
  assert.match(
    verified.output,
    /BACKUP_VERIFIED label=release-1 objects=present/,
  );
});

test('이미 있는 백업은 덮어쓰지 않는다', LONG, () => {
  const dir = workspace();
  const backups = join(dir, 'backups');
  mkdirSync(backups);
  writeFileSync(join(backups, 'release-1.sql'), 'previous backup');
  const result = run('backup.sh', [
    '--label',
    'release-1',
    '--backup-dir',
    backups,
  ]);
  assert.equal(result.status, 1, result.output);
  assert.equal(
    readFileSync(join(backups, 'release-1.sql'), 'utf8'),
    'previous backup',
  );
  assert.deepEqual(readdirSync(backups), ['release-1.sql']);
});

for (const [name, dockerBody, env, mirror] of [
  ['pg_dump 실패', 'exit 3', {}, null],
  ['빈 덤프', 'exit 0', {}, null],
  ['잘린 덤프', "printf 'CREATE TABLE half (\\n'; exit 0", {}, null],
  ['멈춘 pg_dump', 'exec sleep 60', { PM_DUMP_TIMEOUT: '1' }, null],
  ['없는 DB', null, { PM_DATABASE: 'no_such_database' }, null],
  [
    '객체 복사 실패',
    null,
    {},
    '#!/bin/sh\necho "$R2_STORAGE_SECRET_ACCESS_KEY"\nexit 4\n',
  ],
  ['객체 0건', null, {}, '#!/bin/sh\nexit 0\n'],
  [
    '멈춘 객체 복사',
    null,
    { PM_MIRROR_TIMEOUT: '1' },
    '#!/bin/sh\nexec sleep 60\n',
  ],
]) {
  test(
    `백업 실패는 exit 0이 아니고 산출물을 남기지 않는다: ${name}`,
    LONG,
    () => {
      const dir = workspace();
      const backups = join(dir, 'backups');
      const bin = dockerBody === null ? undefined : stubBin(dir, dockerBody);
      const args = ['--label', 'release-1', '--backup-dir', backups];
      if (mirror) {
        writeFiles(dir, { 'mirror.sh': mirror });
        args.push('--', join(dir, 'mirror.sh'));
      }
      const result = run('backup.sh', args, env, bin);
      assert.equal(result.status, 1, result.output);
      assert.doesNotMatch(result.output, /BACKUP_OK/);
      assert.deepEqual(readdirSync(backups), []);
    },
  );
}

test('영수증과 다른 백업은 재검증에서 실패한다', LONG, () => {
  const dir = workspace();
  rehearsalManifest(dir);
  const backups = join(dir, 'backups');
  const backedUp = run('backup.sh', [
    '--label',
    'release-1',
    '--backup-dir',
    backups,
    '--',
    join(dir, 'mirror.sh'),
  ]);
  assert.equal(backedUp.status, 0, backedUp.output);

  writeFileSync(join(backups, 'release-1.objects', 'one'), 'tampered-object');
  const tamperedObject = run('verify-backup.sh', [backups, 'release-1']);
  assert.equal(tamperedObject.status, 1, tamperedObject.output);
  assert.match(tamperedObject.output, /object hash mismatch/);
  writeFileSync(join(backups, 'release-1.objects', 'one'), 'object-one');

  writeFileSync(join(backups, 'release-1.objects', 'extra'), 'extra');
  const extraObject = run('verify-backup.sh', [backups, 'release-1']);
  assert.equal(extraObject.status, 1, extraObject.output);
  assert.match(extraObject.output, /object count mismatch/);
  rmSync(join(backups, 'release-1.objects', 'extra'));

  writeFileSync(join(backups, 'release-1.sql'), 'tampered-dump');
  const tamperedDump = run('verify-backup.sh', [backups, 'release-1']);
  assert.equal(tamperedDump.status, 1, tamperedDump.output);
  assert.match(tamperedDump.output, /dump hash mismatch/);

  rmSync(join(backups, 'release-1.receipt'));
  const missingReceipt = run('verify-backup.sh', [backups, 'release-1']);
  assert.equal(missingReceipt.status, 1, missingReceipt.output);
});

test(
  '리허설은 전환 후 쓰기, 되돌리기, 삭제 후 복원까지 통과하고 흔적을 남기지 않는다',
  LONG,
  () => {
    const dir = workspace();
    const result = rehearse(rehearsalManifest(dir));
    assert.equal(result.status, 0, result.output);
    const order = [
      'STEP restore production dump',
      'PREFLIGHT_OK',
      'STEP apply copy',
      'RECONCILE_OK stage=copy',
      'STEP cutover write',
      'STEP previous image check',
      'STEP old structure reconcile',
      'STEP backup before drop-old',
      'BACKUP_VERIFIED',
      'STEP apply drop-old',
      'RECONCILE_OK stage=drop-old',
      'STEP restore backup and compare counts',
      'COUNT application-rows before=3 restored=3',
      'COUNT file-rows before=2 restored=2',
      'REHEARSAL_OK name=fixture-rehearsal stages=3 counts=2',
    ];
    let cursor = 0;
    for (const marker of order) {
      const found = result.output.indexOf(marker, cursor);
      assert.ok(
        found >= 0,
        `missing or out of order: ${marker}\n${result.output}`,
      );
      cursor = found;
    }
    assert.equal(rehearsalDatabases(), '0');
    assert.equal(
      sql('fixture_source', 'SELECT count(*) FROM "Application"'),
      '2',
    );
  },
);

test('단일 PR 형식은 cutover 없이 첫 단계 앞에서 백업한다', LONG, () => {
  const dir = workspace();
  const manifest = rehearsalManifest(dir, {
    cutover: undefined,
    objectMirror: undefined,
    stages: [
      { id: 'all', apply: ['copy.sql'], reconcile: ['reconcile-copy.sql'] },
    ],
    backupBeforeStage: 'all',
  });
  const result = rehearse(manifest);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /COUNT application-rows before=2 restored=2/);
  assert.match(result.output, /REHEARSAL_OK name=fixture-rehearsal stages=1/);
  assert.equal(rehearsalDatabases(), '0');
});

for (const [name, mutate, env, expected, forbidden] of [
  [
    '단계 대조 불일치',
    (dir) => writeFiles(dir, { 'reconcile-copy.sql': 'SELECT 5;\n' }),
    {},
    /mismatches=5/,
    'STEP cutover write',
  ],
  [
    '적용 SQL 부분 실패',
    (dir) =>
      writeFiles(dir, {
        'copy.sql': `CREATE TABLE "Team" (LIKE "Application"); SELECT no_such_column; INSERT INTO "Team" SELECT * FROM "Application";\n`,
      }),
    {},
    /apply failed/,
    'STEP reconcile copy',
  ],
  [
    '이전 이미지 확인 실패',
    (dir) =>
      writeFiles(dir, {
        'previous-image.sh':
          '#!/bin/sh\necho "$R2_STORAGE_SECRET_ACCESS_KEY"\nexit 7\n',
      }),
    {},
    /previous image check: exit 7/,
    'STEP old structure reconcile',
  ],
  [
    '멈춘 이전 이미지 확인',
    (dir) =>
      writeFiles(dir, { 'previous-image.sh': '#!/bin/sh\nexec sleep 60\n' }),
    { PM_HOOK_TIMEOUT: '1' },
    /previous image check: timed out/,
    'STEP old structure reconcile',
  ],
  [
    '옛 구조 대조 불일치',
    (dir) => writeFiles(dir, { 'reconcile-old.sql': 'SELECT 1;\n' }),
    {},
    /old structure reconcile failed/,
    'STEP backup before',
  ],
  [
    '백업 실패 시 삭제 금지',
    (dir) => writeFiles(dir, { 'mirror.sh': '#!/bin/sh\nexit 4\n' }),
    {},
    /pre-deletion backup failed/,
    'STEP apply drop-old',
  ],
  [
    '복원 후 행 건수 불일치',
    (dir) =>
      writeFiles(dir, {
        'count-files.sql': `SELECT CASE WHEN current_database() LIKE '%\\_restore' THEN 99 ELSE 2 END;\n`,
      }),
    {},
    /COUNT file-rows before=2 restored=99[\s\S]*restored counts differ/,
    'REHEARSAL_OK',
  ],
  [
    '건수 쿼리 형식 오류',
    (dir) => writeFiles(dir, { 'count-files.sql': 'SELECT 1; SELECT 2;\n' }),
    {},
    /must print exactly one integer/,
    'STEP apply drop-old',
  ],
]) {
  test(
    `리허설 실패는 exit 0이 아니고 DB를 남기지 않는다: ${name}`,
    LONG,
    () => {
      const dir = workspace();
      const manifest = rehearsalManifest(dir);
      mutate(dir);
      const result = rehearse(manifest, env);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, expected);
      assert.ok(!result.output.includes(forbidden), result.output);
      assert.doesNotMatch(result.output, /REHEARSAL_OK/);
      assert.equal(rehearsalDatabases(), '0');
    },
  );
}

test('운영 원장과 다른 오래된 덤프는 첫 단계 전에 멈춘다', LONG, () => {
  const dir = workspace();
  const manifest = rehearsalManifest(dir, {
    expectedHeadMigration: '20261104000000_newer_head',
  });
  const result = rehearse(manifest);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /ledger mismatch/);
  assert.doesNotMatch(result.output, /STEP apply/);
  assert.equal(rehearsalDatabases(), '0');
});

test('잘린 덤프는 복원에서 실패한다', LONG, () => {
  const dir = workspace();
  const truncated = join(dir, 'truncated.sql');
  writeFileSync(
    truncated,
    'CREATE TABLE half (id int);\nCOPY nope FROM stdin;\n',
  );
  const result = rehearse(rehearsalManifest(dir), { PM_DUMP_FILE: truncated });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /restore into/);
  assert.equal(rehearsalDatabases(), '0');
});

test(
  '중단된 리허설은 실패로 끝나고 DB와 훅 프로세스를 남기지 않는다',
  LONG,
  async () => {
    const dir = workspace();
    const manifest = rehearsalManifest(dir);
    const marker = join(dir, 'hook-started');
    writeFiles(dir, {
      'previous-image.sh': `#!/bin/sh\necho $$ > '${marker}.tmp'\nmv '${marker}.tmp' '${marker}'\nexec sleep 300\n`,
    });
    const started = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('previous image hook did not start')),
        60_000,
      );
      const watcher = watch(dir, () => {
        if (!existsSync(marker)) return;
        clearTimeout(timer);
        watcher.close();
        resolve();
      });
    });
    const child = spawn('bash', [join(SCRIPTS, 'rehearse.sh'), manifest], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PM_PG_CONTAINER: container, PM_DUMP_FILE: dump },
    });
    const exited = new Promise((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });
    await started;
    const hookPid = Number(readFileSync(marker, 'utf8').trim());
    process.kill(-child.pid, 'SIGTERM');
    const { code, signal } = await exited;
    assert.ok(
      code !== 0 || signal !== null,
      'aborted rehearsal reported success',
    );
    assert.equal(rehearsalDatabases(), '0');
    assert.throws(() => process.kill(hookPid, 0), { code: 'ESRCH' });
  },
);

test('격리 라벨이 없는 컨테이너는 거부한다', LONG, () => {
  const dir = workspace();
  const bin = stubBin(
    dir,
    `case "$1" in inspect) printf '\\n'; exit 0;; *) echo unexpected-docker-call >&2; exit 98;; esac`,
  );
  const result = rehearse(rehearsalManifest(dir), {}, bin);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /not labelled as an isolated/);
  assert.doesNotMatch(result.output, /unexpected-docker-call/);
});

test(
  '이전 실행의 리허설 DB가 남아 있으면 시작하지 않고 건드리지 않는다',
  LONG,
  () => {
    const dir = workspace();
    sql('postgres', 'CREATE DATABASE pm_rehearsal_stale_main');
    try {
      const result = rehearse(rehearsalManifest(dir));
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /already has 1 rehearsal databases/);
      assert.equal(rehearsalDatabases(), '1');
    } finally {
      sql('postgres', 'DROP DATABASE pm_rehearsal_stale_main');
    }
  },
);

test('필수 입력이 없으면 실패한다', LONG, () => {
  const dir = workspace();
  const manifest = rehearsalManifest(dir);
  assert.equal(run('rehearse.sh', []).status, 1);
  assert.equal(
    run('rehearse.sh', [manifest], { PM_DUMP_FILE: join(dir, 'none') }).status,
    1,
  );
  assert.equal(
    run('preflight.sh', [manifest], { PM_PG_CONTAINER: '' }).status,
    1,
  );
  assert.equal(
    run('backup.sh', ['--label', '../escape', '--backup-dir', dir]).status,
    1,
  );
  assert.ok(!existsSync(join(dir, 'escape.sql')));
});
