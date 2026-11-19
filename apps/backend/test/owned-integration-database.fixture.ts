import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { loadPrismaPoolConfig } from '../src/platform/prisma-pool.config';
import { loadPrismaQueryLintConfig } from '../src/platform/prisma-query-lint.config';
import { assertIsolatedIntegrationDatabase } from './integration-database.guard';

const run = promisify(execFile);

export async function createOwnedIntegrationDatabase() {
  const source = process.env.DATABASE_URL;
  assertIsolatedIntegrationDatabase({
    databaseUrl: source,
    runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
  });
  if (source === undefined)
    throw new TypeError('Missing isolated database URL');
  const name = 'oss_hub_fixture_' + randomUUID().replaceAll('-', '');
  const url = new URL(source);
  const admin = new Client({ connectionString: source });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch (error) {
    await admin.end();
    throw error;
  }
  const drop = async () => {
    try {
      await admin.query(`DROP DATABASE "${name}"`);
    } finally {
      await admin.end();
    }
  };
  url.pathname = '/' + name;
  try {
    await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url.toString() },
    });
    const base = new PrismaClient({
      adapter: new PrismaPg(loadPrismaPoolConfig(url.toString())),
    });
    const prisma = Object.assign(
      loadPrismaQueryLintConfig().createLintedClient(base),
      {
        onModuleInit: () => base.$connect(),
        onModuleDestroy: () => base.$disconnect(),
      },
    );
    return {
      prisma,
      async close() {
        try {
          await base.$disconnect();
        } finally {
          await drop();
        }
      },
    };
  } catch (error) {
    await drop();
    throw error;
  }
}
