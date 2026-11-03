import { PrismaService } from '../platform/prisma.service';
import { buildRow } from '../auth/auth.repository.spec-support';
import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { IndependentAuthorityRepository } from './independent-authority.repository';

function harness(requestId: string | null = 'approved-request') {
  let current = {
    ...buildRow({
      id: 'target',
      type: 'STAFF',
      name: 'Name',
      department: 'Department',
      departmentType: 'PROGRAM_OFFICE',
      profileCreatedAt: new Date('2026-01-01'),
      approvalStatus: 'APPROVED',
      approvalRequestId: requestId,
      approvalRequestedAt: requestId === null ? null : new Date('2026-01-01'),
      admin: { userId: 'target' },
    }),
    loginHistories: [],
  };
  const update = jest
    .fn()
    .mockImplementation((input: { data: Partial<typeof current> }) => {
      current = { ...current, ...input.data };
      return Promise.resolve(current);
    });
  const revoke = jest.fn().mockImplementation(() => {
    current = { ...current, admin: null };
    return Promise.resolve({ userId: 'target' });
  });
  const prisma = Object.assign(new PrismaService(), {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'target' }]),
    user: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(current)),
      findUniqueOrThrow: jest
        .fn()
        .mockImplementation(() => Promise.resolve(current)),
      update,
    },
    admin: { delete: revoke },
  });
  Object.assign(prisma, {
    $transaction: <T>(operation: (client: PrismaService) => Promise<T>) =>
      operation(prisma),
  });
  const reads = new AdminAccessReadRepository(
    new AdminAccessReadOrderingRepository(),
  );
  const admins = new AdminRepository(prisma);
  const transitions = new UserTransitionRepository();
  const access = new AdminAccessRepository(
    prisma,
    new AdminAccessHistoryRepository(),
    reads,
    admins,
    transitions,
  );
  return {
    repository: new IndependentAuthorityRepository(
      prisma,
      reads,
      access,
      admins,
    ),
    prisma,
    update,
    revoke,
    current: () => current,
  };
}
it('revokes only the Admin relation and preserves User identity and approval', async () => {
  const h = harness();
  await h.repository.withTransaction(async (store) => {
    expect(store.auditLogWriter).toBe(h.prisma);
    const before = await store.findUserForUpdate('target');
    if (!before) throw new TypeError('Missing target');
    expect(
      await store.updateAuthority('target', {
        actorId: 'actor',
        memberKind: 'STAFF',
        selectedMemberKind: 'STAFF',
        hasStaffAccess: true,
        hasAdminAccess: false,
        role: 'STAFF',
      }),
    ).toEqual({
      approvalStatus: 'APPROVED',
      approvalRequestId: 'approved-request',
    });
  });
  expect(h.revoke).toHaveBeenCalledWith({ where: { userId: 'target' } });
  expect(h.update).not.toHaveBeenCalled();
  expect(h.current()).toMatchObject({
    type: 'STAFF',
    approvalStatus: 'APPROVED',
    admin: null,
  });
});
it.each(['approved-request', null] as const)(
  'revokes approval without inventing a submitted request when id=%s',
  async (requestId) => {
    const h = harness(requestId);
    const at = new Date('2026-02-01');
    const request = await h.repository.withTransaction((store) =>
      store.insertRevokedRequest({
        userId: 'target',
        actorId: 'actor',
        decidedAt: at,
      }),
    );
    expect(request.id).toBe(requestId ?? 'target');
    expect(h.current()).toMatchObject({
      approvalStatus: 'REVOKED',
      approvalRequestId: requestId,
      approvalDecidedById: 'actor',
      approvalDecidedAt: at,
    });
    expect(h.update).toHaveBeenCalledWith({
      where: { id: 'target' },
      data: {
        approvalStatus: 'REVOKED',
        approvalDecidedAt: at,
        approvalDecidedById: 'actor',
        approvalReason: null,
      },
    });
  },
);
