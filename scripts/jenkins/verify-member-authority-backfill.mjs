#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const BACKFILL_VERSION = '20260822-member-authority-v2';
const EXPECTED_MIGRATION_COUNT = 51;

async function main() {
  const [ledgerPath, baselinePath, applyPath, postPath] = process.argv.slice(2);
  if (
    !ledgerPath ||
    !baselinePath ||
    !applyPath ||
    !postPath ||
    process.argv.length !== 6
  ) {
    throw new TypeError(
      'Usage: verify-member-authority-backfill <ledger> <baseline> <apply> <post>',
    );
  }
  const [ledger, baseline, applied, post] = await Promise.all(
    [ledgerPath, baselinePath, applyPath, postPath].map(async (path) =>
      JSON.parse(await readFile(path, 'utf8')),
    ),
  );

  assert.deepEqual(ledger, {
    status: 'ok',
    migrationCount: EXPECTED_MIGRATION_COUNT,
  });
  for (const receipt of [baseline, applied, post]) {
    assert.equal(receipt.version, BACKFILL_VERSION);
  }
  assert.deepEqual(baseline.aggregate, applied.before);
  assert.deepEqual(baseline.expected.aggregate, applied.after);
  assert.deepEqual(applied.after, post.aggregate);
  const changeKeys = [
    'changedUsers',
    'changedProfiles',
    'createdProfiles',
    'clearedNonStudentIds',
  ];
  const expectedChanges = baseline.expected;
  for (const key of changeKeys) {
    assert.ok(Number.isSafeInteger(expectedChanges[key]));
    assert.ok(expectedChanges[key] >= 0);
    assert.equal(applied[key], expectedChanges[key]);
    assert.equal(post.expected[key], 0);
  }
  assert.ok(expectedChanges.changedUsers > 0);

  for (const key of [
    'users',
    'requests',
    'legacyRoles',
    'requestStatuses',
    'requestHistoryHash',
  ]) {
    assert.deepEqual(applied.before[key], applied.after[key]);
  }
  assert.deepEqual(applied.before.unassignedMemberKinds, {
    STUDENT: 0,
    STAFF: 0,
    UNRESOLVED: applied.before.legacyRoles.UNASSIGNED,
  });
  assert.deepEqual(
    applied.before.unassignedMemberKinds,
    applied.after.unassignedMemberKinds,
  );
  assert.equal(
    applied.after.memberKinds.STUDENT,
    applied.before.memberKinds.STUDENT +
      applied.before.backfillTargets.memberKinds.STUDENT,
  );
  assert.equal(
    applied.after.memberKinds.STAFF,
    applied.before.memberKinds.STAFF +
      applied.before.backfillTargets.memberKinds.STAFF,
  );
  assert.deepEqual(applied.after.backfillTargets, {
    memberKinds: { STUDENT: 0, STAFF: 0 },
    selectedMemberKinds: { STUDENT: 0, STAFF: 0, UNRESOLVED: 0 },
  });
  assert.equal(
    applied.after.memberKinds.UNRESOLVED_ASSIGNED,
    applied.after.compatibilityOnlyAdminAuthorities,
  );
  process.stdout.write('member-authority-backfill-invariants: ok\n');
}

main().catch((error) => {
  const kind = error instanceof Error ? error.name : 'UnknownError';
  process.stderr.write(
    `member-authority-backfill-invariants: failed kind=${kind}\n`,
  );
  process.exitCode = 1;
});
