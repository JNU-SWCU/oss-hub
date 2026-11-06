import { buildRow } from '../auth/auth.repository.spec-support';
import { PrismaService } from '../platform/prisma.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { UserProfileService } from './user-profile.service';
import { MemberRegistrationResetService } from './member-registration-reset.service';
import type { UserAuditInput } from './user-history.types';
import type { UserHistoryTransaction } from './user-history.repository';
import type { MemberRegistrationResetStore } from './member-registration-reset.repository';
const command = {
  expectedMemberKind: 'STUDENT',
  expectedApprovalStatus: 'NOT_REQUIRED',
  expectedApprovalRequestId: null,
} as const;
function harness() {
  let target: ReturnType<typeof buildRow> | null = buildRow({
    id: 'target',
    type: 'STUDENT',
  });
  const actor = {
    id: 'actor',
    githubId: 424243n,
    githubLogin: 'synthetic-admin',
    name: 'Synthetic admin',
    memberKind: 'STUDENT' as const,
    approvalStatus: 'NOT_REQUIRED' as const,
    department: 'Synthetic department',
    profileCreatedAt: new Date('2026-01-01'),
    hasAdminAccess: true,
    accountStatus: 'ACTIVE' as const,
  };
  const store = {
    userHistoryWriter: new PrismaService(),
    lockActiveAdmins: jest.fn().mockResolvedValue(undefined),
    findActorByGithubId: jest.fn().mockResolvedValue(actor),
    findTargetForUpdate: jest
      .fn()
      .mockImplementation(() => Promise.resolve(target)),
    hasActivity: jest.fn().mockResolvedValue(false),
    resetRegistration: jest.fn().mockResolvedValue(true),
  } satisfies MemberRegistrationResetStore;
  const audit = {
    record: jest
      .fn<Promise<void>, [UserAuditInput, UserHistoryTransaction]>()
      .mockResolvedValue(undefined),
  };
  const metadata = new HistoryMetadataService();
  const service = new MemberRegistrationResetService(
    { withTransaction: (operation) => operation(store) },
    audit,
    metadata,
    new UserProfileService(),
    new AdminAccessMutationService(metadata, new UserProfileService()),
  );
  return {
    service,
    store,
    audit,
    setTarget: (value: typeof target) => {
      target = value;
    },
  };
}
describe('member registration reset', () => {
  it.each(['STUDENT', 'STAFF'] as const)(
    'returns an unselected result for %s without granting staff authority',
    async (type) => {
      const h = harness();
      h.setTarget(
        buildRow({
          id: 'target',
          type,
          approvalStatus: type === 'STAFF' ? 'PENDING' : 'NOT_REQUIRED',
        }),
      );
      expect(
        await h.service.resetFromRequest(424243n, 'target', {
          ...command,
          expectedMemberKind: type,
          expectedApprovalStatus: type === 'STAFF' ? 'PENDING' : 'NOT_REQUIRED',
        }),
      ).toEqual({
        id: 'target',
        memberKind: null,
        role: null,
        hasStaffAccess: false,
        hasAdminAccess: false,
        approvalStatus: 'NOT_REQUIRED',
        approvalRequestId: null,
      });
      const recorded: unknown = h.audit.record.mock.calls[0]?.[0];
      expect(recorded).toMatchObject({
        metadata: { command: 'RESET_MEMBER_KIND' },
      });
      expect(h.audit.record.mock.calls[0]?.[1]).toBe(h.store.userHistoryWriter);
    },
  );
  it.each([
    ['missing', null, 'ROL_010'],
    ['self', buildRow({ id: 'actor', type: 'STUDENT' }), 'ROL_023'],
    ['unselected', buildRow({ id: 'target' }), 'ROL_013'],
    [
      'admin',
      buildRow({ id: 'target', type: 'STUDENT', admin: { userId: 'target' } }),
      'ROL_024',
    ],
  ] as const)('rejects %s without writing', async (_, target, code) => {
    const h = harness();
    h.setTarget(target);
    await expect(
      h.service.resetFromRequest(424243n, target?.id ?? 'target', command),
    ).rejects.toMatchObject({ errorCode: { code } });
    expect(h.store.resetRegistration).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });
  it.each([
    { expectedMemberKind: 'STAFF' },
    { expectedApprovalStatus: 'PENDING' },
    { expectedApprovalRequestId: 'different' },
  ] as const)('rejects stale expectation %j', async (expectation) => {
    const h = harness();
    await expect(
      h.service.resetFromRequest(424243n, 'target', {
        ...command,
        ...expectation,
      }),
    ).rejects.toMatchObject({ errorCode: { code: 'ROL_013' } });
    expect(h.store.resetRegistration).not.toHaveBeenCalled();
  });
  it('rejects activity without writing', async () => {
    const h = harness();
    jest.mocked(h.store.hasActivity).mockResolvedValue(true);
    await expect(
      h.service.resetFromRequest(424243n, 'target', command),
    ).rejects.toMatchObject({ errorCode: { code: 'ROL_025', status: 409 } });
    expect(h.store.resetRegistration).not.toHaveBeenCalled();
  });
  it('maps a failed conditional write to stale without audit', async () => {
    const h = harness();
    jest.mocked(h.store.resetRegistration).mockResolvedValue(false);
    await expect(
      h.service.resetFromRequest(424243n, 'target', command),
    ).rejects.toMatchObject({ errorCode: { code: 'ROL_013' } });
    expect(h.audit.record).not.toHaveBeenCalled();
  });
  it.each([null, false] as const)(
    'rejects unauthorized actor %j',
    async (access) => {
      const h = harness();
      jest.mocked(h.store.findActorByGithubId).mockResolvedValue(
        access === null
          ? null
          : {
              id: 'other',
              githubId: 3n,
              githubLogin: 'synthetic',
              name: null,
              memberKind: null,
              department: null,
              profileCreatedAt: null,
              approvalStatus: 'NOT_REQUIRED',
              accountStatus: 'ACTIVE',
              hasAdminAccess: access,
            },
      );
      await expect(
        h.service.resetFromRequest(424243n, 'target', command),
      ).rejects.toMatchObject({
        errorCode: { status: access === null ? 401 : 403 },
      });
      expect(h.store.resetRegistration).not.toHaveBeenCalled();
    },
  );
});
