import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const verifierPath = fileURLToPath(
  new URL('./verify-member-authority-backfill.mjs', import.meta.url),
);
const root = mkdtempSync(join(tmpdir(), 'member-authority-invariants-'));
const before = aggregateBefore();
const afterState = aggregateAfter();

after(() => rmSync(root, { recursive: true, force: true }));

test('production debugger fixture retains exact state-class partitions', () => {
  assert.deepEqual(productionStateClasses(), {
    pristine: {
      assignedMatchedSelection: 39,
      assignedNullSelection: 20,
      staleSelection: 3,
      unassigned: 2,
    },
    onceAppliedV1: { valid: 45, nullGaps: 16, staleConflicts: 3, unsafe: 0 },
    exactV2: { assigned: 62, unassigned: 2, unsafe: 0 },
  });
});

test('Jenkins verifier accepts the production-shaped pristine projection', () => {
  const result = verify();
  assert.equal(result.status, 0, result.stderr);
});

test('Jenkins verifier accepts the production-shaped once-v1 projection', () => {
  const result = verify({
    baselineAggregate: aggregateOnceAppliedV1(),
    expectedChanges: onceAppliedChanges(),
  });
  assert.equal(result.status, 0, result.stderr);
});

test('Jenkins verifier rejects a no-op first apply', () => {
  const result = verify({
    expectedChanges: {
      changedUsers: 0,
      changedProfiles: 0,
      createdProfiles: 0,
      clearedNonStudentIds: 0,
    },
  });
  assert.equal(result.status, 1);
});

test('Jenkins verifier accepts any positive tuple bound to baseline.expected', () => {
  const expectedChanges = {
    changedUsers: 7,
    changedProfiles: 2,
    createdProfiles: 1,
    clearedNonStudentIds: 1,
  };
  const result = verify({ expectedChanges });
  assert.equal(result.status, 0, result.stderr);
});

test('Jenkins verifier rejects pristine baseline paired with once-applied tuple', () => {
  const result = verify({ appliedChanges: onceAppliedChanges() });
  assert.equal(result.status, 1);
});

test('Jenkins verifier rejects old synthetic 62 tuple for production pristine baseline', () => {
  const result = verify({
    appliedChanges: {
      changedUsers: 62,
      changedProfiles: 60,
      createdProfiles: 4,
      clearedNonStudentIds: 8,
    },
  });
  assert.equal(result.status, 1);
});

test('Jenkins verifier rejects old synthetic 3 tuple for production once-v1 baseline', () => {
  const result = verify({
    baselineAggregate: aggregateOnceAppliedV1(),
    expectedChanges: onceAppliedChanges(),
    appliedChanges: {
      changedUsers: 3,
      changedProfiles: 0,
      createdProfiles: 0,
      clearedNonStudentIds: 0,
    },
  });
  assert.equal(result.status, 1);
});

test('Jenkins verifier rejects once-applied baseline paired with pristine tuple', () => {
  const expectedChanges = onceAppliedChanges();
  const result = verify({
    baselineAggregate: aggregateOnceAppliedV1(),
    expectedChanges,
    appliedChanges: pristineChanges(),
  });
  assert.equal(result.status, 1);
});

test('Jenkins verifier rejects apply.before drift from the fresh baseline', () => {
  const appliedBefore = {
    ...before,
    staffAccess: before.staffAccess + 1,
  };
  const result = verify({ appliedBefore });
  assert.equal(result.status, 1);
});

test('Jenkins verifier rejects baseline projection aggregate drift', () => {
  const projectedAggregate = {
    ...afterState,
    selectedMemberKinds: {
      ...afterState.selectedMemberKinds,
      UNRESOLVED: afterState.selectedMemberKinds.UNRESOLVED + 1,
    },
  };
  const result = verify({ projectedAggregate });
  assert.equal(result.status, 1);
});

test('Jenkins verifier rejects broken deterministic and selected-member transitions', () => {
  const broken = {
    ...afterState,
    memberKinds: { ...afterState.memberKinds, STUDENT: 51 },
    selectedMemberKinds: {
      ...afterState.selectedMemberKinds,
      STUDENT: 53,
      UNRESOLVED: 6,
    },
  };
  const result = verify({ appliedAfter: broken, postAggregate: broken });
  assert.equal(result.status, 1);
});

test('Jenkins verifier rejects request identity or status drift', () => {
  const drifted = {
    ...afterState,
    requestStatuses: { ...afterState.requestStatuses, APPROVED: 3 },
    requestHistoryHash: 'c'.repeat(64),
  };
  const result = verify({ appliedAfter: drifted, postAggregate: drifted });
  assert.equal(result.status, 1);
});

test('Jenkins verifier rejects malformed or unexpected migration ledgers', () => {
  assert.equal(verify({ ledger: {} }).status, 1);
  assert.equal(
    verify({ ledger: { status: 'ok', migrationCount: 50 } }).status,
    1,
  );
  assert.equal(
    verify({
      ledger: {
        status: 'rejected',
        issues: ['rolled-back:synthetic_migration'],
      },
    }).status,
    1,
  );
});

test('Jenkins verifier rejects a different backfill version', () => {
  const result = verify({ version: 'unexpected-version' });
  assert.equal(result.status, 1);
});

function verify({
  version = '20260822-member-authority-v2',
  ledger = { status: 'ok', migrationCount: 51 },
  baselineAggregate = before,
  expectedChanges = pristineChanges(),
  appliedChanges = expectedChanges,
  appliedBefore = baselineAggregate,
  projectedAggregate = afterState,
  appliedAfter = afterState,
  postAggregate = afterState,
} = {}) {
  const ledgerPath = write('ledger.json', ledger);
  const baselinePath = write('baseline.json', {
    version: '20260822-member-authority-v2',
    aggregate: baselineAggregate,
    expected: {
      ...expectedChanges,
      aggregate: projectedAggregate,
    },
  });
  const applyPath = write('apply.json', {
    version,
    ...appliedChanges,
    before: appliedBefore,
    after: appliedAfter,
  });
  const postPath = write('post.json', {
    version: '20260822-member-authority-v2',
    aggregate: postAggregate,
    expected: {
      changedUsers: 0,
      changedProfiles: 0,
      createdProfiles: 0,
      clearedNonStudentIds: 0,
      aggregate: postAggregate,
    },
  });
  return spawnSync(
    process.execPath,
    [verifierPath, ledgerPath, baselinePath, applyPath, postPath],
    { encoding: 'utf8' },
  );
}

function write(name, value) {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function productionStateClasses() {
  return {
    pristine: {
      assignedMatchedSelection: 39,
      assignedNullSelection: 20,
      staleSelection: 3,
      unassigned: 2,
    },
    onceAppliedV1: { valid: 45, nullGaps: 16, staleConflicts: 3, unsafe: 0 },
    exactV2: { assigned: 62, unassigned: 2, unsafe: 0 },
  };
}

function pristineChanges() {
  return {
    changedUsers: 64,
    changedProfiles: 62,
    createdProfiles: 4,
    clearedNonStudentIds: 4,
  };
}

function onceAppliedChanges() {
  return {
    changedUsers: 19,
    changedProfiles: 0,
    createdProfiles: 0,
    clearedNonStudentIds: 0,
  };
}

function aggregateBefore() {
  return {
    users: 64,
    profiles: 58,
    requests: 4,
    legacyRoles: { STUDENT: 54, STAFF: 3, ADMIN: 5, UNASSIGNED: 2 },
    memberKinds: { STUDENT: 0, STAFF: 0, UNRESOLVED_ASSIGNED: 62 },
    selectedMemberKinds: { STUDENT: 0, STAFF: 0, UNRESOLVED: 64 },
    unassignedMemberKinds: { STUDENT: 0, STAFF: 0, UNRESOLVED: 2 },
    backfillTargets: {
      memberKinds: { STUDENT: 54, STAFF: 3 },
      selectedMemberKinds: { STUDENT: 56, STAFF: 3, UNRESOLVED: 0 },
    },
    requestStatuses: { PENDING: 0, APPROVED: 4, REJECTED: 0, REVOKED: 0 },
    requestHistoryHash: 'b'.repeat(64),
    staffAccess: 0,
    adminAccess: 0,
    compatibilityOnlyAdminAuthorities: 0,
  };
}

function aggregateAfter() {
  return {
    ...aggregateBefore(),
    profiles: 62,
    memberKinds: { STUDENT: 54, STAFF: 3, UNRESOLVED_ASSIGNED: 5 },
    selectedMemberKinds: { STUDENT: 56, STAFF: 3, UNRESOLVED: 5 },
    backfillTargets: {
      memberKinds: { STUDENT: 0, STAFF: 0 },
      selectedMemberKinds: { STUDENT: 0, STAFF: 0, UNRESOLVED: 0 },
    },
    staffAccess: 8,
    adminAccess: 5,
    compatibilityOnlyAdminAuthorities: 5,
  };
}

function aggregateOnceAppliedV1() {
  return {
    ...aggregateAfter(),
    selectedMemberKinds: { STUDENT: 39, STAFF: 5, UNRESOLVED: 20 },
    backfillTargets: {
      memberKinds: { STUDENT: 0, STAFF: 0 },
      selectedMemberKinds: { STUDENT: 17, STAFF: 1, UNRESOLVED: 1 },
    },
  };
}
