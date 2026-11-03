import { Prisma, type ApprovalStatus } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { buildRow } from '../auth/auth.repository.spec-support';
import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AdminAccessRepository } from './admin-access.repository';

function harness() {
  let current = {
    ...buildRow({
      id: 'target',
      type: 'STAFF',
      approvalStatus: 'PENDING',
      approvalRequestId: 'request',
      approvalRequestedAt: new Date('2026-01-01'),
      name: 'Name',
      department: 'Department',
      departmentType: 'DEPARTMENT',
      profileCreatedAt: new Date('2026-01-01'),
    }),
    loginHistories: [],
  };
  const queries: Prisma.Sql[] = [];
  const update = jest
    .fn()
    .mockImplementation((args: { data: Partial<typeof current> }) => {
      current = { ...current, ...args.data };
      return Promise.resolve(current);
    });
  const updateMany = jest.fn().mockImplementation(
    (args: {
      where: {
        approvalRequestId?: string;
        approvalStatus?: ApprovalStatus;
        type?: string;
      };
      data: Partial<typeof current>;
    }) => {
      const matches =
        (args.where.approvalRequestId === undefined ||
          args.where.approvalRequestId === current.approvalRequestId) &&
        (args.where.approvalStatus === undefined ||
          args.where.approvalStatus === current.approvalStatus) &&
        (args.where.type === undefined || args.where.type === current.type);
      if (matches) current = { ...current, ...args.data };
      return Promise.resolve({ count: matches ? 1 : 0 });
    },
  );
  const prisma = Object.assign(new PrismaService(), {
    $queryRaw: jest.fn().mockImplementation((sql: Prisma.Sql) => {
      queries.push(sql);
      return Promise.resolve([{ id: 'target' }]);
    }),
    admin: { count: jest.fn().mockResolvedValue(2) },
    user: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(current)),
      findUniqueOrThrow: jest
        .fn()
        .mockImplementation(() => Promise.resolve(current)),
      update,
      updateMany,
    },
  });
  Object.assign(prisma, {
    $transaction: <T>(operation: (client: PrismaService) => Promise<T>) =>
      operation(prisma),
  });
  return {
    repository: new AdminAccessRepository(
      prisma,
      new AdminAccessHistoryRepository(),
      new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
      new AdminRepository(prisma),
      new UserTransitionRepository(),
    ),
    prisma,
    queries,
    update,
    updateMany,
    current: () => current,
  };
}
it('locks User rows before returning raw current state and the same history writer', async () => {
  const h = harness();
  const result = await h.repository.withTransaction(async (store) => ({
    count: await store.lockActiveAdmins(),
    target: await store.findUserForUpdate('target'),
    writer: store.auditLogWriter,
  }));
  expect(result).toMatchObject({
    count: 2,
    target: {
      id: 'target',
      memberKind: 'STAFF',
      approvalStatus: 'PENDING',
      approvalRequestId: 'request',
    },
  });
  expect(result.writer).toBe(h.prisma);
  expect(h.queries[0]?.sql).toContain('ORDER BY u."id" FOR UPDATE OF u, a');
  expect(h.queries[1]?.sql).toContain('FOR UPDATE');
});
it('decides exactly one matching PENDING request using the User approval tuple', async () => {
  const h = harness();
  const input = {
    requestId: 'request',
    actorId: 'admin',
    nextStatus: 'APPROVED' as const,
    rejectionReason: null,
    decidedAt: new Date('2026-02-01'),
  };
  await h.repository.withTransaction(async (store) => {
    expect(await store.decidePendingRequest(input)).toBe(true);
    expect(await store.decidePendingRequest(input)).toBe(false);
  });
  expect(h.current()).toMatchObject({
    approvalStatus: 'APPROVED',
    approvalRequestId: 'request',
    approvalDecidedById: 'admin',
  });
  expect(h.updateMany).toHaveBeenCalledWith({
    where: {
      type: 'STAFF',
      approvalRequestId: 'request',
      approvalStatus: 'PENDING',
    },
    data: {
      approvalStatus: 'APPROVED',
      approvalReason: null,
      approvalDecidedById: 'admin',
      approvalDecidedAt: input.decidedAt,
    },
  });
});
it('rejects a stale current request before any account or authority write', async () => {
  const h = harness();
  const updated = await h.repository.withTransaction((store) =>
    store.compareAndSwapAccess({
      userId: 'target',
      actorId: 'admin',
      expectedType: 'STAFF',
      expectedApprovalStatus: 'PENDING',
      expectedApprovalRequestId: 'old',
      expectedHasStaffAccess: false,
      expectedHasAdminAccess: false,
      expectedAccountStatus: 'ACTIVE',
      desiredAccountStatus: 'DEACTIVATED',
      desiredHasStaffAccess: false,
      desiredHasAdminAccess: false,
      decidesPendingRequest: false,
    }),
  );
  expect(updated).toBe(false);
  expect(h.update).not.toHaveBeenCalled();
});
