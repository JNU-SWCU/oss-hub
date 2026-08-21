#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const BACKFILL_VERSION = '20260821-member-authority-v1';
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
  assert.equal(post.expected.changedUsers, 0);
  assert.equal(post.expected.changedProfiles, 0);

  const expectedChanges = baseline.expected;
  assert.ok(Number.isSafeInteger(expectedChanges.changedUsers));
  assert.ok(expectedChanges.changedUsers > 0);
  for (const key of [
    'changedUsers',
    'changedProfiles',
    'createdProfiles',
    'clearedNonStudentIds',
  ]) {
    assert.equal(applied[key], expectedChanges[key]);
  }

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
  assert.equal(
    applied.after.selectedMemberKinds.STUDENT,
    applied.before.selectedMemberKinds.STUDENT +
      applied.before.backfillTargets.selectedMemberKinds.STUDENT,
  );
  assert.equal(
    applied.after.selectedMemberKinds.STAFF,
    applied.before.selectedMemberKinds.STAFF +
      applied.before.backfillTargets.selectedMemberKinds.STAFF,
  );
  assert.deepEqual(applied.after.backfillTargets, {
    memberKinds: { STUDENT: 0, STAFF: 0 },
    selectedMemberKinds: { STUDENT: 0, STAFF: 0 },
  });
  assert.equal(applied.after.memberKinds.UNRESOLVED_ASSIGNED, 5);
  assert.equal(applied.after.compatibilityOnlyAdminAuthorities, 5);
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
