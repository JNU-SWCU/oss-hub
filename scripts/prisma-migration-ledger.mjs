#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateMigrationLedger(committedNames, rows) {
  const issues = [];
  const committed = new Set(committedNames);
  const counts = new Map();

  for (const row of rows) {
    counts.set(row.migrationName, (counts.get(row.migrationName) ?? 0) + 1);
    if (!committed.has(row.migrationName)) {
      issues.push(`unexpected:${row.migrationName}`);
    }
    if (row.finishedAt === null) {
      issues.push(`unfinished:${row.migrationName}`);
    }
    if (row.rolledBackAt !== null) {
      issues.push(`rolled-back:${row.migrationName}`);
    }
  }

  for (const migrationName of committedNames) {
    const count = counts.get(migrationName) ?? 0;
    if (count !== 1) {
      issues.push(`count:${migrationName}:${count}`);
    }
  }
  return issues;
}

async function main() {
  const migrationsPath = process.argv[2];
  if (migrationsPath === undefined) {
    process.stderr.write(
      'Usage: node scripts/prisma-migration-ledger.mjs <migrations-directory>\n',
    );
    process.exitCode = 2;
    return;
  }

  const committedNames = readdirSync(migrationsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const backendDirectory = dirname(dirname(migrationsPath));
  const require = createRequire(join(backendDirectory, 'package.json'));
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw`
      SELECT
        migration_name AS "migrationName",
        finished_at AS "finishedAt",
        rolled_back_at AS "rolledBackAt"
      FROM "_prisma_migrations"
      ORDER BY migration_name
    `;
    const issues = validateMigrationLedger(committedNames, rows);
    if (issues.length > 0) {
      process.stderr.write(
        `${JSON.stringify({ status: 'rejected', issues })}\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `${JSON.stringify({ status: 'ok', migrationCount: committedNames.length })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(
      `${JSON.stringify({ status: 'error', reason: 'ledger-query-failed' })}\n`,
    );
    process.exitCode = 1;
  });
}
