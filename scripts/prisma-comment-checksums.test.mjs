import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = join(root, 'apps/backend/prisma/migrations');
const reconciliationName = '20261022000000_reconcile_comment_cleanup_checksums';
const reconciliation = readFileSync(
  join(migrations, reconciliationName, 'migration.sql'),
  'utf8',
);
const mapping = JSON.parse(reconciliation.split('$mapping$')[1]);
const baseline = '93a6d5a4eb81ee33905115c310cd757030bb16f5';
const useBaseline = process.argv.includes('--baseline');
const evidence = resolve(
  process.env.MIGRATION_CHECKSUM_EVIDENCE_DIR ??
    join(root, '.omo/evidence/comment-migrations', randomUUID()),
);
mkdirSync(evidence, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'oss-checksum-test-'));
const container = `oss-checksum-test-${randomUUID()}`;
const image = readFileSync(join(root, 'compose.yml'), 'utf8').match(
  /image:\s*(postgres:17[^\s]+)/,
)?.[1];
assert.ok(image, 'production PostgreSQL 17 image must be pinned');
const events = [];
let created = false;
let port;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 180_000,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}
function check(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
function capture(label, result) {
  writeFileSync(
    join(evidence, `${label}.log`),
    `exit=${result.status}\n${result.stdout ?? ''}${result.stderr ?? ''}`
      .replaceAll(root, '<repository>')
      .replaceAll(temporary, '<temporary>')
      .replace(/postgresql:\/\/[^\s"']+/g, '<isolated-database>'),
  );
  return result;
}
function sql(database, input, label) {
  const result = run(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      database,
      '-At',
    ],
    { input },
  );
  if (label) capture(label, result);
  return result;
}
function url(database) {
  return `postgresql://postgres:synthetic-test-only@127.0.0.1:${port}/${database}?schema=public`;
}
function prisma(database, args, label) {
  return capture(
    label,
    run('pnpm', ['--filter', 'backend', 'exec', 'prisma', ...args], {
      env: {
        ...process.env,
        DATABASE_URL: url(database),
        SHADOW_DATABASE_URL: url('shadow'),
      },
    }),
  );
}
function ledger(database, omitChecksum = false) {
  return check(
    sql(
      database,
      `SELECT coalesce(jsonb_agg(${omitChecksum ? "to_jsonb(m) - 'checksum'" : 'to_jsonb(m)'} ORDER BY migration_name,id), '[]') FROM "_prisma_migrations" m WHERE migration_name <> '${reconciliationName}';`,
    ),
  );
}
function snapshot(database) {
  return check(
    run('docker', [
      'exec',
      container,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      database,
      '--exclude-table=public._prisma_migrations',
      '--no-owner',
      '--no-privileges',
    ]),
  )
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith('\\restrict ') && !line.startsWith('\\unrestrict '),
    )
    .join('\n');
}
function verifyChecksums(database) {
  const rows = JSON.parse(
    check(
      sql(
        database,
        "SELECT jsonb_agg(jsonb_build_object('name', migration_name, 'checksum', checksum)) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;",
      ),
    ),
  );
  assert.equal(rows.length, mapping.length + 1);
  for (const row of rows)
    assert.equal(
      row.checksum,
      createHash('sha256')
        .update(readFileSync(join(migrations, row.name, 'migration.sql')))
        .digest('hex'),
      row.name,
    );
  return rows;
}
try {
  const sourceHistory = join(temporary, 'source-migrations');
  cpSync(migrations, sourceHistory, { recursive: true });
  const futureName = '99991231235959_checksum_suite_future_fixture';
  mkdirSync(join(sourceHistory, futureName));
  writeFileSync(
    join(sourceHistory, futureName, 'migration.sql'),
    'CREATE TABLE "FutureChecksumProbe" (id TEXT PRIMARY KEY);\n',
  );
  const cutoff = join(temporary, 'cutoff');
  mkdirSync(join(cutoff, 'migrations'), { recursive: true });
  writeFileSync(
    join(cutoff, 'schema.prisma'),
    readFileSync(join(root, 'apps/backend/prisma/schema.prisma')),
  );
  for (const entry of readdirSync(sourceHistory, { withFileTypes: true })) {
    if (
      entry.name === 'migration_lock.toml' ||
      (entry.isDirectory() && entry.name <= reconciliationName)
    )
      cpSync(
        join(sourceHistory, entry.name),
        join(cutoff, 'migrations', entry.name),
        { recursive: true },
      );
  }
  const deployCutoff = [
    'migrate',
    'deploy',
    '--schema',
    join(cutoff, 'schema.prisma'),
  ];
  writeFileSync(
    join(evidence, 'replay-inputs.json'),
    JSON.stringify(
      {
        source: readdirSync(sourceHistory).sort(),
        selected: readdirSync(join(cutoff, 'migrations')).sort(),
      },
      null,
      2,
    ),
  );
  for (const entry of mapping) {
    assert.equal(
      entry.new,
      createHash('sha256')
        .update(readFileSync(join(migrations, entry.name, 'migration.sql')))
        .digest('hex'),
    );
    if (useBaseline) {
      const original = run('git', [
        'show',
        `${baseline}:apps/backend/prisma/migrations/${entry.name}/migration.sql`,
      ]);
      check(original);
      assert.equal(
        entry.old,
        createHash('sha256').update(original.stdout).digest('hex'),
      );
    }
  }
  assert.equal(
    new Set(mapping.map((entry) => entry.name)).size,
    mapping.length,
  );
  check(
    capture(
      'container-create',
      run('docker', [
        'run',
        '--detach',
        '--name',
        container,
        '--label',
        'oss-hub.test=comment-checksums',
        '--publish',
        '127.0.0.1::5432',
        '--env',
        'POSTGRES_PASSWORD=synthetic-test-only',
        image,
      ]),
    ),
  );
  created = true;
  port = check(run('docker', ['port', container, '5432/tcp']))
    .split(':')
    .at(-1);
  assert.match(port, /^\d+$/);
  for (let attempt = 0; ; attempt++) {
    if (
      run('docker', ['exec', container, 'pg_isready', '-U', 'postgres'])
        .status === 0
    )
      break;
    assert.ok(attempt < 60, 'isolated PostgreSQL startup');
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  check(
    capture(
      'versions',
      run('pnpm', ['--filter', 'backend', 'exec', 'prisma', '--version']),
    ),
  );
  check(sql('postgres', 'SELECT version();', 'postgres-version'));
  check(
    sql(
      'postgres',
      'CREATE DATABASE fresh; CREATE DATABASE upgrade; CREATE DATABASE shadow; CREATE DATABASE minimal;',
      'create-databases',
    ),
  );
  check(
    sql(
      'minimal',
      readFileSync(join(sourceHistory, futureName, 'migration.sql'), 'utf8'),
      'future-migration-valid',
    ),
  );
  check(prisma('fresh', deployCutoff, 'fresh-deploy'));
  writeFileSync(
    join(evidence, 'fresh-checksums.json'),
    JSON.stringify(verifyChecksums('fresh'), null, 2),
  );
  assert.equal(
    check(
      sql(
        'fresh',
        `SELECT to_regclass('"FutureChecksumProbe"') IS NULL;`,
        'future-migration-excluded',
      ),
    ),
    't',
  );
  events.push(
    'fresh full replay through reconciliation cutoff: PASS; later ordinary migration excluded',
  );
  const history = join(temporary, 'history');
  mkdirSync(join(history, 'migrations'), { recursive: true });
  writeFileSync(
    join(history, 'schema.prisma'),
    readFileSync(join(root, 'apps/backend/prisma/schema.prisma')),
  );
  writeFileSync(
    join(history, 'migrations/migration_lock.toml'),
    'provider = "postgresql"\n',
  );
  for (const entry of mapping) {
    mkdirSync(join(history, 'migrations', entry.name));
    const content = useBaseline
      ? run('git', [
          'show',
          `${baseline}:apps/backend/prisma/migrations/${entry.name}/migration.sql`,
        ]).stdout
      : readFileSync(join(migrations, entry.name, 'migration.sql'));
    writeFileSync(
      join(history, 'migrations', entry.name, 'migration.sql'),
      content,
    );
  }
  check(
    prisma(
      'upgrade',
      ['migrate', 'deploy', '--schema', join(history, 'schema.prisma')],
      'historical-deploy',
    ),
  );
  if (!useBaseline)
    check(
      sql(
        'upgrade',
        mapping
          .map(
            (entry) =>
              `UPDATE "_prisma_migrations" SET checksum='${entry.old}' WHERE migration_name='${entry.name}';`,
          )
          .join('\n'),
      ),
    );
  check(
    sql(
      'upgrade',
      'INSERT INTO "User" (id,"githubId",login,"updatedAt") VALUES (\'checksum-fixture\',987654321,\'synthetic-checksum-fixture\',CURRENT_TIMESTAMP);',
    ),
  );
  const before = snapshot('upgrade');
  const metadataBefore = ledger('upgrade', true);
  check(prisma('upgrade', deployCutoff, 'upgrade-deploy'));
  assert.equal(
    snapshot('upgrade'),
    before,
    'business schema and data unchanged',
  );
  assert.equal(
    ledger('upgrade', true),
    metadataBefore,
    'all historical metadata except checksum unchanged',
  );
  writeFileSync(join(evidence, 'metadata-before.json'), metadataBefore);
  writeFileSync(join(evidence, 'metadata-after.json'), ledger('upgrade', true));
  writeFileSync(join(evidence, 'business-before.sql'), before);
  writeFileSync(join(evidence, 'business-after.sql'), snapshot('upgrade'));
  writeFileSync(
    join(evidence, 'upgrade-checksums.json'),
    JSON.stringify(verifyChecksums('upgrade'), null, 2),
  );
  events.push(
    `${useBaseline ? 'exact baseline' : 'old-checksum fixture'} upgrade: PASS; business schema/data and non-checksum metadata unchanged`,
  );
  const after = ledger('upgrade');
  const repeat = prisma('upgrade', deployCutoff, 'repeat-deploy');
  check(repeat);
  assert.match(repeat.stdout, /No pending migrations/);
  check(sql('upgrade', reconciliation, 'repeat-direct'));
  assert.equal(ledger('upgrade'), after);
  events.push('repeated deployment and direct reconciliation: PASS');
  const first = mapping.find((entry) => entry.old !== entry.new);
  const last = mapping.at(-1);
  for (const [label, mutation] of [
    [
      'unknown',
      `UPDATE "_prisma_migrations" SET checksum=repeat('f',64) WHERE migration_name='${last.name}';`,
    ],
    [
      'missing',
      `DELETE FROM "_prisma_migrations" WHERE migration_name='${last.name}';`,
    ],
    [
      'ambiguous',
      `INSERT INTO "_prisma_migrations" SELECT 'duplicate-fixture',checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count FROM "_prisma_migrations" WHERE migration_name='${last.name}';`,
    ],
    [
      'unfinished',
      `UPDATE "_prisma_migrations" SET finished_at=NULL WHERE migration_name='${last.name}';`,
    ],
    [
      'self_ambiguous',
      `INSERT INTO "_prisma_migrations" SELECT 'duplicate-self-fixture',checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count FROM "_prisma_migrations" WHERE migration_name='${reconciliationName}';`,
    ],
  ]) {
    const database = `reject_${label}`;
    check(sql('postgres', `CREATE DATABASE ${database} TEMPLATE upgrade;`));
    check(
      sql(
        database,
        `UPDATE "_prisma_migrations" SET checksum='${first.old}' WHERE migration_name='${first.name}'; ${mutation}`,
      ),
    );
    const beforeFailure = ledger(database);
    const result = sql(database, reconciliation, `reject-${label}`);
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, /checksum reconciliation:/);
    assert.equal(
      ledger(database),
      beforeFailure,
      `${label} must rollback every change`,
    );
    events.push(`${label} all-or-nothing rejection: PASS`);
  }
  const minimal = join(temporary, 'minimal');
  mkdirSync(join(minimal, reconciliationName), { recursive: true });
  writeFileSync(
    join(minimal, 'migration_lock.toml'),
    'provider = "postgresql"\n',
  );
  writeFileSync(
    join(minimal, reconciliationName, 'migration.sql'),
    reconciliation,
  );
  check(
    prisma(
      'minimal',
      [
        'migrate',
        'diff',
        '--from-migrations',
        minimal,
        '--to-empty',
        '--shadow-database-url',
        url('shadow'),
        '--exit-code',
      ],
      'minimal-shadow',
    ),
  );
  assert.equal(
    check(
      sql(
        'shadow',
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';",
      ),
    ),
    '0',
  );
  events.push(
    'actual minimal Prisma shadow replay without ledger: PASS; no persistent tables',
  );
  if (useBaseline) {
    const oldShadow = prisma(
      'minimal',
      [
        'migrate',
        'diff',
        '--from-migrations',
        join(history, 'migrations'),
        '--to-empty',
        '--shadow-database-url',
        url('shadow'),
      ],
      'historical-shadow',
    );
    const newShadow = prisma(
      'minimal',
      [
        'migrate',
        'diff',
        '--from-migrations',
        join(cutoff, 'migrations'),
        '--to-empty',
        '--shadow-database-url',
        url('shadow'),
      ],
      'full-shadow',
    );
    assert.notEqual(oldShadow.status, 0);
    assert.notEqual(newShadow.status, 0);
    for (const result of [oldShadow, newShadow]) {
      assert.match(result.stderr, /20260824000000_contract_member_authority/);
      assert.match(result.stderr, /_prisma_migrations/);
    }
    events.push(
      'full shadow replay: inherited failure at 20260824000000_contract_member_authority verified before/after; NOT PASS',
    );
  }
} finally {
  if (created) {
    check(
      capture(
        'cleanup',
        run('docker', ['rm', '--force', '--volumes', container]),
      ),
    );
    assert.notEqual(run('docker', ['inspect', container]).status, 0);
    events.push('owned container and anonymous volumes removed: PASS');
  }
  rmSync(temporary, { recursive: true, force: true });
  writeFileSync(join(evidence, 'summary.txt'), events.join('\n') + '\n');
}
console.log(events.join('\n'));
console.log(`Evidence: ${evidence}`);
