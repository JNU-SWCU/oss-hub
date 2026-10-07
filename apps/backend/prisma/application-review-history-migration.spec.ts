import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(resolve(__dirname, 'schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(
    __dirname,
    'migrations/20260920030000_add_application_review_history/migration.sql',
  ),
  'utf8',
);

function modelBlock(source: string, model: string): string {
  const start = source.indexOf(`model ${model} {`);
  assert.notEqual(start, -1, `model ${model} 선언을 찾지 못했다`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `model ${model} 블록이 닫히지 않았다`);
  return source.slice(start, end);
}

test('history rows hang off Application alone and cascade on its deletion', () => {
  const block = modelBlock(schema, 'ApplicationReviewHistory');

  assert.match(
    block,
    /application\s+Application\s+@relation\(fields: \[applicationId\], references: \[id\], onDelete: Cascade\)/,
  );

  assert.equal(/programId/.test(block), false);
  assert.equal(/teamId/.test(block), false);

  assert.match(
    block,
    /actor\s+User\s+@relation\(fields: \[actorId\], references: \[id\], onDelete: Restrict\)/,
  );
});

test('history keeps the immutable event shape the review timeline reads', () => {
  const block = modelBlock(schema, 'ApplicationReviewHistory');

  assert.match(block, /eventKind\s+ApplicationReviewEventKind/);

  assert.match(block, /revision\s+Int\s*$/m);
  assert.match(block, /rejectionReason\s+String\?/);

  assert.match(block, /@@index\(\[applicationId, occurredAt\]\)/);
});

test('the five review events are exactly the transitions the domain can produce', () => {
  const start = schema.indexOf('enum ApplicationReviewEventKind {');
  assert.notEqual(start, -1);
  const block = schema.slice(start, schema.indexOf('\n}', start));
  const values = block
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  assert.deepEqual(values, [
    'SUBMITTED',
    'RESUBMITTED',
    'APPROVED',
    'REJECTED',
    'REVERTED',
  ]);
});

test('Application carries the submission revision with a backfill-safe default', () => {
  const block = modelBlock(schema, 'Application');

  assert.match(block, /revision\s+Int\s+@default\(1\)/);
  assert.match(block, /reviewHistories\s+ApplicationReviewHistory\[\]/);
});

test('the migration is additive and declares the same cascade as the schema', () => {
  assert.match(
    migration,
    /ALTER TABLE "ApplicationReviewHistory" ADD CONSTRAINT "ApplicationReviewHistory_applicationId_fkey" FOREIGN KEY \("applicationId"\) REFERENCES "Application"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE;/,
  );
  assert.match(
    migration,
    /ALTER TABLE "Application" ADD COLUMN\s+"revision" INTEGER NOT NULL DEFAULT 1;/,
  );

  assert.equal(
    /DROP COLUMN|DROP TABLE|DROP TYPE|SET NOT NULL/.test(migration),
    false,
  );
});
