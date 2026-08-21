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

test('Jenkins verifier accepts the exact nonzero deterministic transition', () => {
  const result = verify();
  assert.equal(result.status, 0, result.stderr);
});

test('Jenkins verifier rejects a no-op first apply', () => {
  const result = verify({ changedUsers: 0 });
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
  version = '20260821-member-authority-v1',
  ledger = { status: 'ok', migrationCount: 51 },
  changedUsers = 62,
  appliedAfter = afterState,
  postAggregate = afterState,
} = {}) {
  const ledgerPath = write('ledger.json', ledger);
  const baselinePath = write('baseline.json', {
    version: '20260821-member-authority-v1',
    aggregate: before,
    expected: {
      changedUsers: 62,
      changedProfiles: 60,
      createdProfiles: 4,
      clearedNonStudentIds: 8,
      aggregate: afterState,
    },
  });
  const applyPath = write('apply.json', {
    version,
    changedUsers,
    changedProfiles: 60,
    createdProfiles: 4,
    clearedNonStudentIds: 8,
    before,
    after: appliedAfter,
  });
  const postPath = write('post.json', {
    version: '20260821-member-authority-v1',
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

function aggregateBefore() {
  return {
    users: 62,
    profiles: 56,
    requests: 4,
    legacyRoles: { STUDENT: 52, STAFF: 3, ADMIN: 5, UNASSIGNED: 2 },
    memberKinds: { STUDENT: 0, STAFF: 0, UNRESOLVED_ASSIGNED: 60 },
    selectedMemberKinds: { STUDENT: 0, STAFF: 0, UNRESOLVED: 62 },
    unassignedMemberKinds: { STUDENT: 0, STAFF: 0, UNRESOLVED: 2 },
    backfillTargets: {
      memberKinds: { STUDENT: 52, STAFF: 3 },
      selectedMemberKinds: { STUDENT: 54, STAFF: 3 },
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
    profiles: 60,
    memberKinds: { STUDENT: 52, STAFF: 3, UNRESOLVED_ASSIGNED: 5 },
    selectedMemberKinds: { STUDENT: 54, STAFF: 3, UNRESOLVED: 5 },
    backfillTargets: {
      memberKinds: { STUDENT: 0, STAFF: 0 },
      selectedMemberKinds: { STUDENT: 0, STAFF: 0 },
    },
    staffAccess: 8,
    adminAccess: 5,
    compatibilityOnlyAdminAuthorities: 5,
  };
}
