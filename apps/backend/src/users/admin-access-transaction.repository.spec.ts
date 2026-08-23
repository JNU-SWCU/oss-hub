import { AccountStatus, Role, StaffAccessRequestStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';

describe('AdminAccessRepository transaction store', () => {
  it('locks active admins deterministically before exposing CAS primitives', async () => {
    // Given
    const operations: string[] = [];
    const updateUser = jest.fn().mockResolvedValue({ count: 1 });
    const updateRequest = jest.fn().mockResolvedValue({ count: 1 });
    const createRequest = jest
      .fn()
      .mockResolvedValue({ id: 'request-revoked' });
    const transaction = {
      $queryRaw: <T>(query: unknown): Promise<T> => {
        const sql = sqlText(query);
        operations.push(sql);
        const rows = sql.includes('role =')
          ? [{ id: 'admin-a' }, { id: 'admin-b' }]
          : [{ id: 'target' }];
        return Promise.resolve(rows as T);
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'target',
          githubId: 9_131_000_002n,
          nickname: 'synthetic-target',
          name: '합성 사용자',
          studentId: '123456',
          department: '소프트웨어공학과',
          profile: null,
          role: Role.STUDENT,
          accountStatus: AccountStatus.ACTIVE,
          staffAccessRequests: [],
          loginHistories: [],
        }),
        updateMany: updateUser,
      },
      staffAccessRequest: {
        updateMany: updateRequest,
        create: createRequest,
      },
      auditLog: { create: jest.fn() },
    };
    const repository = new AdminAccessRepository({
      $transaction: <T>(
        operation: (store: typeof transaction) => Promise<T>,
      ): Promise<T> => operation(transaction),
    } as unknown as PrismaService);
    const decidedAt = new Date('2026-07-24T00:00:00.000Z');

    // When
    const result = await repository.withTransaction(async (store) => ({
      activeAdminCount: await store.lockActiveAdmins(),
      target: await store.findUserForUpdate('target'),
      userUpdated: await store.compareAndSwapAccess({
        userId: 'target',
        expectedRole: Role.STUDENT,
        expectedAccountStatus: AccountStatus.ACTIVE,
        desiredRole: Role.STAFF,
        desiredAccountStatus: AccountStatus.ACTIVE,
        desiredHasStaffAccess: true,
        desiredHasAdminAccess: false,
      }),
      requestUpdated: await store.decidePendingRequest({
        requestId: 'request-pending',
        actorId: 'admin-a',
        nextStatus: StaffAccessRequestStatus.APPROVED,
        rejectionReason: null,
        decidedAt,
      }),
      revokedRequest: await store.insertRevokedRequest({
        userId: 'target',
        actorId: 'admin-a',
        decidedAt,
      }),
      auditWriter: store.auditLogWriter,
    }));

    // Then
    expect(result).toMatchObject({
      activeAdminCount: 2,
      target: { id: 'target' },
      userUpdated: true,
      requestUpdated: true,
      revokedRequest: { id: 'request-revoked' },
      auditWriter: transaction,
    });
    expect(operations[0]).toContain('FROM "User"');
    expect(operations[0]).toContain('ORDER BY id');
    expect(operations[0]).toContain('FOR UPDATE');
    expect(operations[1]).toContain('WHERE id =');
    expect(operations[1]).toContain('FOR UPDATE');
    expect(updateUser).toHaveBeenCalledWith({
      where: {
        id: 'target',
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      },
      data: {
        role: Role.STAFF,
        accountStatus: AccountStatus.ACTIVE,
        hasStaffAccess: true,
        hasAdminAccess: false,
      },
    });
    expect(updateRequest).toHaveBeenCalledWith({
      where: { id: 'request-pending', status: StaffAccessRequestStatus.PENDING },
      data: {
        status: StaffAccessRequestStatus.APPROVED,
        rejectionReason: null,
        decidedById: 'admin-a',
        decidedAt,
      },
    });
    // 회수는 기존 행을 건드리지 않는다 — 새 REVOKED 행을 넣는 것이 전부다.
    expect(createRequest).toHaveBeenCalledWith({
      data: {
        userId: 'target',
        status: StaffAccessRequestStatus.REVOKED,
        decidedById: 'admin-a',
        decidedAt,
      },
      select: { id: true },
    });
    expect(updateRequest).toHaveBeenCalledTimes(1);
  });
});

function sqlText(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const strings: unknown = Reflect.get(value, 'strings');
    if (Array.isArray(strings)) {
      return strings.join('');
    }
  }
  return String(value);
}
