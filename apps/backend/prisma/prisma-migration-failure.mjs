import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const command = process.argv[2];

function classify(text) {
  const lines = text.split(/\r?\n/);
  const lockLine = lines.find(
    (line) =>
      line.includes('55P03') ||
      line.includes('OSS_HUB_LOCK_TIMEOUT') ||
      line.includes('canceling statement due to lock timeout'),
  );
  if (lockLine !== undefined) {
    return { kind: 'lock_timeout', cause: lockLine.trim() };
  }
  const databaseError = lines.find((line) => {
    const trimmed = line.trim();
    if (!trimmed.includes('ERROR:')) return false;
    if (trimmed.includes('25P02')) return false;
    if (trimmed.toLowerCase().includes('current transaction is aborted')) {
      return false;
    }
    return true;
  });
  const cause =
    databaseError ??
    lines.find((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return false;
      if (trimmed.includes('25P02')) return false;
      if (trimmed.toLowerCase().includes('current transaction is aborted')) {
        return false;
      }
      return trimmed.includes('P3009') || trimmed.includes('Error:');
    });
  return {
    kind: 'other',
    cause: (cause ?? 'unknown failure').trim(),
  };
}

async function withPrisma(operation) {
  const prisma = new PrismaClient();
  try {
    return await operation(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function fingerprint(prisma) {
  const rows = await prisma.$queryRaw`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name
  `;
  const text = rows
    .map(
      (row) =>
        `${row.table_name}.${row.column_name}.${row.data_type}.${row.is_nullable}`,
    )
    .join('\n');
  process.stdout.write(`${createHash('sha256').update(text).digest('hex')}\n`);
}

async function pending(prisma) {
  const rows = await prisma.$queryRaw`
    SELECT migration_name, logs
    FROM "_prisma_migrations"
    WHERE finished_at IS NULL
      AND rolled_back_at IS NULL
      AND started_at IS NOT NULL
    ORDER BY started_at
  `;
  if (rows.length === 0) {
    process.stdout.write('none\n');
    return;
  }
  if (rows.length > 1) {
    process.stdout.write('many\n');
    return;
  }
  const result = classify(rows[0].logs ?? '');
  process.stdout.write(
    `${result.kind}\n${rows[0].migration_name}\n${result.cause}\n`,
  );
}

if (command === 'classify') {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const result = classify(chunks.join(''));
  process.stdout.write(`${result.kind}\n${result.cause}\n`);
} else if (command === 'fingerprint') {
  await withPrisma(fingerprint);
} else if (command === 'pending') {
  await withPrisma(pending);
} else {
  process.stderr.write('usage: fingerprint | pending | classify\n');
  process.exit(2);
}
