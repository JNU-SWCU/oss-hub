import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    __dirname,
    'migrations/20260920030000_add_application_review_history/migration.sql',
  ),
  'utf8',
);

const historyTable = migration
  .split('CREATE TABLE "ApplicationReviewHistory" (')[1]
  ?.split('\n);')[0];

test('historical history rows hang off Application alone and cascade on its deletion', () => {
  assert.ok(historyTable);
  assert.match(
    migration,
    /FOREIGN KEY \("applicationId"\) REFERENCES "Application"\("id"\) ON DELETE CASCADE/,
  );
  assert.equal(/programId|teamId/.test(historyTable), false);
  assert.match(
    migration,
    /FOREIGN KEY \("actorId"\) REFERENCES "User"\("id"\) ON DELETE RESTRICT/,
  );
});

test('history keeps the immutable event shape the review timeline reads', () => {
  assert.ok(historyTable);
  assert.match(
    historyTable,
    /"eventKind" "ApplicationReviewEventKind" NOT NULL/,
  );
  assert.match(historyTable, /"revision" INTEGER NOT NULL/);
  assert.match(historyTable, /"rejectionReason" TEXT,/);
  assert.match(
    migration,
    /CREATE INDEX "ApplicationReviewHistory_applicationId_occurredAt_idx" ON "ApplicationReviewHistory"\("applicationId", "occurredAt"\)/,
  );
});

test('the five historical review events are exactly the transitions the domain can produce', () => {
  const declaration = migration.match(
    /CREATE TYPE "ApplicationReviewEventKind" AS ENUM \(([^)]+)\)/,
  )?.[1];
  assert.ok(declaration);
  const values = [...declaration.matchAll(/'([^']+)'/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(values, [
    'SUBMITTED',
    'RESUBMITTED',
    'APPROVED',
    'REJECTED',
    'REVERTED',
  ]);
});

test('Application carries the submission revision with a backfill-safe default', () => {
  assert.match(
    migration,
    /ALTER TABLE "Application" ADD COLUMN\s+"revision" INTEGER NOT NULL DEFAULT 1;/,
  );
  assert.ok(historyTable);
  assert.match(historyTable, /"applicationId" TEXT NOT NULL/);
});

test('the historical migration adds history storage without retiring existing data', () => {
  assert.match(migration, /CREATE TABLE "ApplicationReviewHistory"/);
  assert.match(
    migration,
    /ALTER TABLE "Application" ADD COLUMN\s+"revision" INTEGER NOT NULL DEFAULT 1;/,
  );

  assert.equal(
    /DROP COLUMN|DROP TABLE|DROP TYPE|SET NOT NULL/.test(migration),
    false,
  );
});
