import { AccountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AdminRepository } from './admin.repository';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { UserProfileService } from './user-profile.service';

type Row = Parameters<AdminAccessReadRepository['toAdminAccessUserRow']>[0];
const at = new Date('2026-01-01');
function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'target',
    githubId: 9140000001n,
    nickname: 'synthetic-target',
    name: 'Name',
    studentId: '123456',
    department: 'Department',
    departmentType: 'DEPARTMENT',
    staffNumber: null,
    type: 'STUDENT',
    profileCreatedAt: at,
    profileUpdatedAt: at,
    approvalStatus: 'NOT_REQUIRED',
    approvalRequestId: null,
    approvalRequestedAt: null,
    approvalDecidedAt: null,
    approvalDecidedById: null,
    approvalReason: null,
    admin: null,
    accountStatus: 'ACTIVE',
    createdAt: at,
    loginHistories: [],
    ...overrides,
  };
}
function repository(prisma: PrismaService) {
  return new AdminAccessRepository(
    prisma,
    new AdminAccessHistoryRepository(),
    new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
    new AdminRepository(prisma),
    new UserTransitionRepository(),
  );
}

describe('administrator actor projection and locks', () => {
  it('returns raw approval and independent Admin existence for the service policy boundary', () => {
    const actor = repository(new PrismaService()).toAdminActor(
      row({
        type: 'STAFF',
        approvalStatus: 'APPROVED',
        admin: { userId: 'target' },
      }),
    );
    expect(actor).toMatchObject({
      memberKind: 'STAFF',
      approvalStatus: 'APPROVED',
      hasAdminAccess: true,
    });
    expect(new UserProfileService().hasStaffAccess(actor)).toBe(true);
  });
  it('does not imply staff approval from an Admin relation', () => {
    const actor = repository(new PrismaService()).toAdminActor(
      row({ admin: { userId: 'target' } }),
    );
    expect(actor.hasAdminAccess).toBe(true);
    expect(new UserProfileService().hasStaffAccess(actor)).toBe(false);
  });
  it.each([
    ['STUDENT', false, false, 'STUDENT'],
    ['STUDENT', false, true, 'ADMIN'],
    ['STAFF', true, false, 'STAFF'],
    [null, false, false, null],
  ] as const)(
    'folds compatibility label for %s/%s/%s',
    (memberKind, hasStaffAccess, hasAdminAccess, expected) => {
      expect(
        new UserProfileService().authorityLabel({
          memberKind,
          hasStaffAccess,
          hasAdminAccess,
        }),
      ).toBe(expected);
    },
  );
  it('locks deterministic User rows and counts current active Admin relations after locking', async () => {
    const queries: Prisma.Sql[] = [];
    const count = jest.fn().mockResolvedValue(1);
    const prisma = Object.assign(new PrismaService(), {
      $queryRaw: jest.fn().mockImplementation((sql: Prisma.Sql) => {
        queries.push(sql);
        return Promise.resolve([{ id: 'admin-a' }, { id: 'admin-b' }]);
      }),
      admin: { count },
    });
    expect(await repository(prisma).lockActiveAdminRows(prisma)).toBe(1);
    expect(queries[0]?.sql).toContain('JOIN "Admin" a');
    expect(queries[0]?.sql).toContain('ORDER BY u."id" FOR UPDATE OF u, a');
    expect(count).toHaveBeenCalledWith({
      where: { user: { accountStatus: AccountStatus.ACTIVE } },
    });
  });
});
it('builds paged user output and search-scoped facets from current approval predicates', async () => {
  const queryRaw = jest.fn().mockResolvedValue([{ id: 'pending' }]);
  const findMany = jest.fn().mockResolvedValue([
    row({
      id: 'pending',
      type: 'STAFF',
      studentId: null,
      approvalStatus: 'PENDING',
      approvalRequestId: 'request',
      approvalRequestedAt: at,
      loginHistories: [{ loginAt: at }],
    }),
  ]);
  const counts = [1, 1, 1, 0, 1, 2, 1, 2, 1];
  const count = jest
    .fn()
    .mockImplementation(() => Promise.resolve(counts.shift()));
  const prisma = Object.assign(new PrismaService(), {
    $queryRaw: queryRaw,
    user: { findMany, count },
  });
  const result = await repository(prisma).list({
    query: 'synthetic',
    role: 'UNASSIGNED',
    accountStatus: 'ACTIVE',
    pendingRequest: 'PENDING',
    page: 1,
    limit: 1,
  });
  expect(result).toEqual({
    items: [
      expect.objectContaining({
        id: 'pending',
        name: 'Name',
        studentId: null,
        department: 'Department',
        pendingRequest: { id: 'request', status: 'PENDING', createdAt: at },
        lastLoginAt: at,
      }),
    ],
    page: 1,
    limit: 1,
    total: 1,
    facets: {
      roles: { unassigned: 1, student: 1, staff: 0, admin: 1 },
      accountStatuses: { active: 2, deactivated: 1 },
      pendingRequests: { none: 2, pending: 1 },
    },
  });
  const where = {
    AND: [
      {
        OR: [
          { name: { contains: 'synthetic', mode: 'insensitive' } },
          { nickname: { contains: 'synthetic', mode: 'insensitive' } },
        ],
      },
      {
        admin: { is: null },
        NOT: {
          OR: [
            { type: 'STUDENT' },
            {
              type: 'STAFF',
              approvalStatus: 'APPROVED',
              profileCreatedAt: { not: null },
              name: { not: null },
              department: { not: null },
            },
          ],
        },
      },
      { accountStatus: 'ACTIVE' },
      {
        type: 'STAFF',
        approvalStatus: 'PENDING',
        approvalRequestId: { not: null },
      },
    ],
  };
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { AND: [where, { id: { in: ['pending'] } }] },
    }),
  );
  expect(count).toHaveBeenNthCalledWith(1, { where });
  expect(count).toHaveBeenCalledTimes(9);
  expect(queryRaw).toHaveBeenCalledWith(
    expect.objectContaining({
      values: ['%synthetic%', '%synthetic%', 'ACTIVE', 1, 0],
    }),
  );
});
it('folds request transitions to one row per request before stable pagination and keeps login history bounded', async () => {
  const request = (
    id: string,
    createdAt: string,
    status: 'PENDING' | 'REJECTED',
  ) => ({
    schemaVersion: 1,
    recordKind: 'REQUEST_TRANSITION',
    request: {
      id,
      userId: 'target',
      status,
      createdAt,
      decidedAt: status === 'REJECTED' ? '2026-03-01T00:00:00.000Z' : null,
      decidedById: status === 'REJECTED' ? 'actor' : null,
      rejectionReason: status === 'REJECTED' ? 'Reason' : null,
    },
  });
  const loginFindMany = jest
    .fn()
    .mockResolvedValue([
      { id: 'login-2', event: 'LOGIN', success: true, loginAt: at },
    ]);
  const prisma = Object.assign(new PrismaService(), {
    user: {
      findUnique: jest.fn().mockResolvedValue(row()),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'actor', nickname: 'synthetic-admin' }]),
    },
    userHistory: {
      findMany: jest.fn().mockResolvedValue([
        {
          event: 'APPROVAL_REQUESTED',
          data: request('request-1', '2026-01-01T00:00:00.000Z', 'PENDING'),
        },
        {
          event: 'APPROVAL_REQUESTED',
          data: request('request-2', '2026-02-01T00:00:00.000Z', 'PENDING'),
        },
        {
          event: 'REJECTED',
          data: request('request-1', '2026-01-01T00:00:00.000Z', 'REJECTED'),
        },
      ]),
    },
    loginHistory: {
      findMany: loginFindMany,
      count: jest.fn().mockResolvedValue(2),
    },
  });
  const repo = repository(prisma);
  const [detail, requests, logins] = await Promise.all([
    repo.findById('target'),
    repo.listStaffAccessRequestHistory('target', { page: 2, limit: 1 }),
    repo.listLoginHistory('target', { page: 2, limit: 1 }),
  ]);
  expect(detail).toMatchObject({
    id: 'target',
    name: 'Name',
    studentId: '123456',
    staffNumber: null,
    department: 'Department',
  });
  expect(requests).toEqual({
    items: [
      {
        id: 'request-1',
        status: 'REJECTED',
        rejectionReason: 'Reason',
        decidedAt: new Date('2026-03-01'),
        decidedBy: 'synthetic-admin',
        createdAt: at,
      },
    ],
    page: 2,
    limit: 1,
    total: 2,
  });
  expect(logins).toEqual({
    items: [
      {
        id: 'login-2',
        event: 'LOGIN',
        provider: 'github',
        success: true,
        loginAt: at,
      },
    ],
    page: 2,
    limit: 1,
    total: 2,
  });
  expect(loginFindMany).toHaveBeenCalledWith(
    expect.objectContaining({
      orderBy: [{ loginAt: 'desc' }, { id: 'desc' }],
      skip: 1,
      take: 1,
    }),
  );
});
