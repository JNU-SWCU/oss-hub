import {
  ACTOR_GITHUB_ID,
  NOW,
  harness,
  staffTarget,
  target,
} from './member-kind.service.spec-support';
import type { MemberKindMutationCommand } from './member-kind.service';

const toStaff = {
  memberKind: 'STAFF',
  expectedMemberKind: 'STUDENT',
  expectedHasStaffAccess: false,
  expectedApprovalStatus: 'NOT_REQUIRED',
  expectedApprovalRequestId: null,
} as const;
const toStudent = {
  memberKind: 'STUDENT',
  expectedMemberKind: 'STAFF',
  expectedHasStaffAccess: true,
  expectedApprovalStatus: 'APPROVED',
  expectedApprovalRequestId: null,
  department: ' New department ',
} as const;

describe('MemberKindService identity transitions', () => {
  it('approves STAFF while preserving studentId and independent Admin, and normalizes staffNumber', async () => {
    const { store, service } = harness();
    store.target = target({ hasAdminAccess: true });
    const result = await service.patchMemberKind(ACTOR_GITHUB_ID, 'target', {
      ...toStaff,
      staffNumber: ' staff-A7 ',
    });
    expect(result).toMatchObject({
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: true,
      approvalStatus: 'APPROVED',
      approvalRequestId: 'replacement-request',
    });
    expect(store.target?.profile).toMatchObject({
      studentId: '123456',
      staffNumber: 'staff-A7',
    });
  });
  it('clears an opaque staffNumber without replacing an existing approval', async () => {
    const { store, service } = harness();
    const before = staffTarget();
    if (!before.profile) throw new TypeError('Missing fixture profile');
    store.target = {
      ...before,
      approvalRequestId: 'approved',
      profile: { ...before.profile, staffNumber: 'staff-A7' },
    };
    const result = await service.patchMemberKind(ACTOR_GITHUB_ID, 'target', {
      memberKind: 'STAFF',
      expectedMemberKind: 'STAFF',
      expectedHasStaffAccess: true,
      expectedApprovalStatus: 'APPROVED',
      expectedApprovalRequestId: 'approved',
      staffNumber: null,
    });
    expect(result.approvalRequestId).toBe('approved');
    expect(store.target?.profile?.staffNumber).toBeNull();
  });
  it('converts STAFF to STUDENT, retaining studentId and Admin and clearing current approval', async () => {
    const { store, service } = harness();
    store.target = staffTarget({ hasAdminAccess: true });
    const result = await service.patchMemberKind(
      ACTOR_GITHUB_ID,
      'target',
      toStudent,
    );
    expect(result).toMatchObject({
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: true,
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
    });
    expect(store.target?.profile).toMatchObject({
      studentId: '123456',
      department: 'New department',
      affiliationKind: 'DEPARTMENT',
    });
  });
  it('allows an administrator own pending STAFF identity command to supersede exactly the matched request', async () => {
    const { store, service } = harness();
    store.target = staffTarget({
      id: 'actor',
      githubId: ACTOR_GITHUB_ID,
      hasAdminAccess: true,
      approvalStatus: 'PENDING',
      approvalRequestId: 'pending',
      pendingRequest: { id: 'pending', status: 'PENDING', createdAt: NOW },
    });
    const result = await service.patchMemberKind(ACTOR_GITHUB_ID, 'actor', {
      memberKind: 'STAFF',
      expectedMemberKind: 'STAFF',
      expectedHasStaffAccess: false,
      expectedApprovalStatus: 'PENDING',
      expectedApprovalRequestId: 'pending',
    });
    expect(result).toMatchObject({
      hasAdminAccess: true,
      hasStaffAccess: true,
      approvalRequestId: 'replacement-request',
    });
    expect(store.writes).toBe(1);
  });
  it.each(['stale-id', 'missing-pair'] as const)(
    'rejects %s when a current submitted request would be replaced',
    async (mode) => {
      const { store, service, audit } = harness();
      store.target = staffTarget({
        approvalStatus: 'PENDING',
        approvalRequestId: 'new',
        pendingRequest: { id: 'new', status: 'PENDING', createdAt: NOW },
      });
      const command: MemberKindMutationCommand = {
        memberKind: 'STAFF',
        expectedMemberKind: 'STAFF',
        expectedHasStaffAccess: false,
        ...(mode === 'stale-id'
          ? {
              expectedApprovalStatus: 'PENDING',
              expectedApprovalRequestId: 'old',
            }
          : {}),
      };
      await expect(
        service.patchMemberKind(ACTOR_GITHUB_ID, 'target', command),
      ).rejects.toMatchObject({ errorCode: { code: 'ROL_013', status: 409 } });
      expect(store.writes).toBe(0);
      expect(audit.record).not.toHaveBeenCalled();
    },
  );
  it('rejects a stale expected approval status even when request ID is unchanged', async () => {
    const { store, service } = harness();
    store.target = staffTarget({
      approvalStatus: 'REJECTED',
      approvalRequestId: 'request',
    });
    await expect(
      service.patchMemberKind(ACTOR_GITHUB_ID, 'target', {
        memberKind: 'STAFF',
        expectedMemberKind: 'STAFF',
        expectedHasStaffAccess: false,
        expectedApprovalStatus: 'PENDING',
        expectedApprovalRequestId: 'request',
      }),
    ).rejects.toMatchObject({ errorCode: { code: 'ROL_013' } });
    expect(store.writes).toBe(0);
  });
  it('retains safe legacy commands only when there is no submitted current request', async () => {
    const { service } = harness();
    await expect(
      service.patchMemberKind(ACTOR_GITHUB_ID, 'target', {
        memberKind: 'STAFF',
        expectedMemberKind: 'STUDENT',
        expectedHasStaffAccess: false,
      }),
    ).resolves.toMatchObject({ hasStaffAccess: true });
  });
  it.each([
    ['missing user', null, { ...toStudent }, 'ROL_010'],
    [
      'missing profile',
      staffTarget({ profile: null }),
      { ...toStudent },
      'USR_002',
    ],
    [
      'missing department',
      staffTarget(),
      { ...toStudent, department: undefined },
      'USR_005',
    ],
    [
      'replacing studentId',
      staffTarget(),
      { ...toStudent, studentId: '654321' },
      'SYS_003',
    ],
    [
      'invalid studentId',
      staffTarget(),
      { ...toStudent, studentId: 'not-id' },
      'SYS_003',
    ],
    [
      'stale staff flag',
      target(),
      { ...toStaff, expectedHasStaffAccess: true },
      'ROL_013',
    ],
  ] as const)(
    '%s rejects before writes',
    async (_label, before, command, code) => {
      const { store, service } = harness();
      store.target = before;
      await expect(
        service.patchMemberKind(ACTOR_GITHUB_ID, 'target', command),
      ).rejects.toMatchObject({ errorCode: { code } });
      expect(store.writes).toBe(0);
    },
  );
  it.each([null, '123456'] as const)(
    'fills or retains valid studentId from %s',
    async (studentId) => {
      const { store, service } = harness();
      const before = staffTarget();
      if (!before.profile) throw new TypeError('Missing fixture profile');
      store.target = { ...before, profile: { ...before.profile, studentId } };
      await expect(
        service.patchMemberKind(ACTOR_GITHUB_ID, 'target', {
          ...toStudent,
          studentId: '123456',
        }),
      ).resolves.toMatchObject({ memberKind: 'STUDENT' });
      expect(store.target?.profile?.studentId).toBe('123456');
    },
  );
  it('rejects missing stored studentId on student conversion', async () => {
    const { store, service } = harness();
    const before = staffTarget();
    if (!before.profile) throw new TypeError('Missing fixture profile');
    store.target = {
      ...before,
      profile: { ...before.profile, studentId: null },
    };
    await expect(
      service.patchMemberKind(ACTOR_GITHUB_ID, 'target', toStudent),
    ).rejects.toMatchObject({ errorCode: { code: 'USR_002' } });
    expect(store.writes).toBe(0);
  });
  it('rejects a non-admin actor', async () => {
    const { store, service } = harness();
    if (!store.actor) throw new TypeError('Missing fixture actor');
    store.actor = { ...store.actor, hasAdminAccess: false };
    await expect(
      service.patchMemberKind(ACTOR_GITHUB_ID, 'target', toStaff),
    ).rejects.toMatchObject({ errorCode: { code: 'ROL_004' } });
    expect(store.writes).toBe(0);
  });
  it.each([
    ['unique', 'USR_008'],
    ['cas', 'ROL_013'],
  ] as const)(
    'maps repository %s conflict without audit',
    async (kind, code) => {
      const { store, service, audit } = harness();
      store.failsUnique = kind === 'unique';
      store.failsCas = kind === 'cas';
      await expect(
        service.patchMemberKind(ACTOR_GITHUB_ID, 'target', toStaff),
      ).rejects.toMatchObject({ errorCode: { code } });
      expect(audit.record).not.toHaveBeenCalled();
    },
  );
});
