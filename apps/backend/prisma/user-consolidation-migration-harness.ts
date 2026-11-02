import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';

const execute = promisify(execFile);
export const migrationId = '20261102160000_consolidate_user_domain';
const backend = process.cwd();
const sqlDirectory = resolve(
  backend,
  '../../scripts/jenkins/user-consolidation',
);
const configuredUrl = process.env.DATABASE_URL;
assertIsolatedIntegrationDatabase({
  databaseUrl: configuredUrl,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
if (!configuredUrl) throw new TypeError('Isolated DATABASE_URL is required');
const databaseUrl = new URL(configuredUrl);
databaseUrl.search = '';
const template = `uc_template_${process.pid}`;
let directory = '';
let sequence = 0;

export async function sql(url: string, statement: string): Promise<string> {
  const child = execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', url], {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  child.stdin?.end(statement);
  const result = await new Promise<string>((resolveResult, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveResult(stdout.trim());
      else reject(new Error(`psql exit ${code}: ${stderr}`));
    });
  });
  return result;
}

function urlFor(name: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export const legacyDatabaseUrl = urlFor(template);

export async function prepareLegacyFixture(): Promise<void> {
  directory = await mkdtemp(join(tmpdir(), 'user-consolidation-'));
  await mkdir(join(directory, 'migrations'));
  const currentSchema = await readFile(
    join(backend, 'prisma/schema.prisma'),
    'utf8',
  );
  const originalUserSchema = await readFile(
    join(backend, 'prisma/user-consolidation-migration-old.fixture.txt'),
    'utf8',
  );
  await writeFile(
    join(directory, 'old-schema.prisma'),
    `${originalUserSchema}\n${currentSchema.slice(currentSchema.indexOf('enum ProgramCategory'))}`,
  );
  await cp(
    join(backend, 'prisma/user-consolidation-migration.fixture.prisma'),
    join(directory, 'schema.prisma'),
  );
  for (const name of await readdir(join(backend, 'prisma/migrations'))) {
    if (name < migrationId || name === 'migration_lock.toml') {
      await cp(
        join(backend, 'prisma/migrations', name),
        join(directory, 'migrations', name),
        { recursive: true },
      );
    }
  }
  await sql(databaseUrl.toString(), `CREATE DATABASE "${template}"`);
  await execute(
    join(backend, 'node_modules/.bin/prisma'),
    ['migrate', 'deploy', '--schema', join(directory, 'schema.prisma')],
    {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: urlFor(template) },
      timeout: 60_000,
    },
  );
}

export async function prepareMigrationFixture(): Promise<void> {
  await prepareLegacyFixture();
  await sql(
    urlFor(template),
    await readFile(
      join(backend, 'prisma/user-consolidation-migration.fixture.sql'),
      'utf8',
    ),
  );
}

export async function cleanupMigrationFixture(): Promise<void> {
  await sql(
    databaseUrl.toString(),
    `DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`,
  );
  if (directory) await rm(directory, { recursive: true, force: true });
}

export async function inMigrationDatabase(
  operation: (url: string) => Promise<void>,
): Promise<void> {
  const name = `uc_test_${process.pid}_${++sequence}`;
  await sql(
    databaseUrl.toString(),
    `CREATE DATABASE "${name}" TEMPLATE "${template}"`,
  );
  try {
    await operation(urlFor(name));
  } finally {
    await sql(databaseUrl.toString(), `DROP DATABASE "${name}" WITH (FORCE)`);
  }
}

export async function forward(
  url: string,
  replacement?: string,
): Promise<void> {
  await cp(
    join(backend, 'prisma/migrations', migrationId),
    join(directory, 'migrations', migrationId),
    { recursive: true },
  );
  if (replacement !== undefined) {
    await writeFile(
      join(directory, 'migrations', migrationId, 'migration.sql'),
      replacement,
    );
  }
  await execute(
    join(backend, 'node_modules/.bin/prisma'),
    ['migrate', 'deploy', '--schema', join(directory, 'schema.prisma')],
    {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: url },
      timeout: 60_000,
    },
  );
}

export async function resolveFailedMigration(url: string): Promise<void> {
  await execute(
    join(backend, 'node_modules/.bin/prisma'),
    [
      'migrate',
      'resolve',
      '--rolled-back',
      migrationId,
      '--schema',
      join(directory, 'schema.prisma'),
    ],
    {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: url },
      timeout: 30_000,
    },
  );
}

export async function schemaDrift(
  url: string,
  phase: 'before' | 'after',
): Promise<string> {
  const schemas = {
    before: join(directory, 'old-schema.prisma'),
    after: join(backend, 'prisma/schema.prisma'),
  };
  const result = await execute(
    join(backend, 'node_modules/.bin/prisma'),
    [
      'migrate',
      'diff',
      '--from-url',
      url,
      '--to-schema-datamodel',
      schemas[phase],
      '--script',
    ],
    {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: url },
      timeout: 30_000,
    },
  );
  return result.stdout;
}

export async function artifact(name: string): Promise<string> {
  return readFile(join(sqlDirectory, `${name}.sql`), 'utf8');
}

export async function sourceSnapshot(url: string): Promise<string> {
  return sql(
    url,
    `SELECT jsonb_build_object(
    'users',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "User" t),
    'profiles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY "userId") FROM "UserProfile" t),
    'requests',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "StaffAccessRequest" t),
    'policies',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Consent" t),
    'audits',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "AuditLog" t),
    'logins',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "LoginHistory" t),
    'ledger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM _prisma_migrations t
       WHERE migration_name <> '${migrationId}'))`,
  );
}
