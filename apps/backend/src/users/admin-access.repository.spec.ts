import { AccountStatus, AffiliationKind, MemberKind, StaffAccessRequestStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_ROLE_FILTERS,
} from './domain/admin-access';
import { AdminAccessRepository } from './admin-access.repository';

describe('AdminAccessRepository', () => {
  it('builds the paged access read model and search-scoped facets', async () => {
    // Given
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'student' }]);
    const findMany = jest.fn().mockResolvedValue([
      userRow({
        id: 'student',
        role: 'STUDENT',
        profile: {
          name: '가나다 학생',
          studentId: '123456',
          department: '소프트웨어공학과',
        },
        pendingRequest: {
          id: 'request-pending',
          status: StaffAccessRequestStatus.PENDING,
          createdAt: new Date('2026-07-20T00:00:00.000Z'),
        },
        lastLoginAt: new Date('2026-07-22T00:00:00.000Z'),
      }),
    ]);
    const count = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const repository = new AdminAccessRepository({
      $queryRaw: queryRaw,
      user: { findMany, count },
    } as unknown as PrismaService);

    // When
    const result = await repository.list({
      query: 'synthetic',
      role: ADMIN_ACCESS_ROLE_FILTERS.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      pendingRequest: ADMIN_ACCESS_PENDING_FILTERS.PENDING,
      page: 1,
      limit: 1,
    });

    // Then
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 'student',
          name: '가나다 학생',
          isProfileComplete: true,
          lastLoginAt: new Date('2026-07-22T00:00:00.000Z'),
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
    expect(result.items[0]?.pendingRequest).toMatchObject({
      id: 'request-pending',
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        // 표시 역할 필터는 canonical 컬럼 조건으로 되짚으므로 바인딩 값이 아니라
        // SQL 리터럴이 된다 — 그래서 'STUDENT'가 values에서 빠진다.
        values: [
          '%synthetic%',
          '%synthetic%',
          AccountStatus.ACTIVE,
          StaffAccessRequestStatus.PENDING,
          1,
          0,
        ],
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: syntheticSearchConditions(),
              hasStaffAccess: false,
              hasAdminAccess: false,
              profile: { is: { memberKind: MemberKind.STUDENT } },
              accountStatus: AccountStatus.ACTIVE,
              staffAccessRequests: { some: { status: StaffAccessRequestStatus.PENDING } },
            },
            { id: { in: ['student'] } },
          ],
        },
      }),
    );
    expect(count).toHaveBeenCalledTimes(9);
    // 1번 호출이 전체 필터를 그대로 건 total count다. facet count(2번 이후)는
    // 각자 자기 차원을 빼고 세므로 여기서 비교하지 않는다.
    expect(count).toHaveBeenNthCalledWith(1, {
      where: {
        OR: syntheticSearchConditions(),
        hasStaffAccess: false,
        hasAdminAccess: false,
        profile: { is: { memberKind: MemberKind.STUDENT } },
        accountStatus: AccountStatus.ACTIVE,
        staffAccessRequests: { some: { status: StaffAccessRequestStatus.PENDING } },
      },
    });
    expect(count).toHaveBeenNthCalledWith(6, {
      where: {
        OR: syntheticSearchConditions(),
        hasStaffAccess: false,
        hasAdminAccess: false,
        profile: { is: { memberKind: MemberKind.STUDENT } },
        accountStatus: AccountStatus.ACTIVE,
        staffAccessRequests: { some: { status: StaffAccessRequestStatus.PENDING } },
      },
    });
    expect(count).toHaveBeenNthCalledWith(8, {
      where: {
        OR: syntheticSearchConditions(),
        hasStaffAccess: false,
        hasAdminAccess: false,
        profile: { is: { memberKind: MemberKind.STUDENT } },
        accountStatus: AccountStatus.ACTIVE,
        staffAccessRequests: { none: { status: StaffAccessRequestStatus.PENDING } },
      },
    });
  });

  it('maps detail and stable role-request/login histories', async () => {
    // Given
    const detail = userRow({ id: 'target', role: 'STAFF' });
    const staffAccessRequestFindMany = jest.fn().mockResolvedValue([
      {
        id: 'request-2',
        status: StaffAccessRequestStatus.REJECTED,
        rejectionReason: '합성 반려 사유',
        decidedAt: new Date('2026-07-22T00:00:00.000Z'),
        decidedBy: { nickname: 'synthetic-admin' },
        createdAt: new Date('2026-07-21T00:00:00.000Z'),
      },
    ]);
    const loginFindMany = jest.fn().mockResolvedValue([
      {
        id: 'login-2',
        event: 'LOGIN',
        provider: 'github',
        success: true,
        loginAt: new Date('2026-07-23T00:00:00.000Z'),
      },
    ]);
    const repository = new AdminAccessRepository({
      user: { findUnique: jest.fn().mockResolvedValue(detail) },
      staffAccessRequest: {
        findMany: staffAccessRequestFindMany,
        count: jest.fn().mockResolvedValue(1),
      },
      loginHistory: {
        findMany: loginFindMany,
        count: jest.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaService);

    // When
    const [user, staffAccessRequests, logins] = await Promise.all([
      repository.findById('target'),
      repository.listStaffAccessRequestHistory('target', { page: 2, limit: 10 }),
      repository.listLoginHistory('target', { page: 2, limit: 10 }),
    ]);

    // Then
    expect(user).toEqual(
      expect.objectContaining({
        id: 'target',
        // 프로필 행이 없으면 세 칸이 모두 비어 있다 — legacy mirror가 사라졌다.
        profile: {
          name: null,
          studentId: null,
          department: null,
          isComplete: false,
        },
      }),
    );
    expect(staffAccessRequests).toEqual({
      items: [
        expect.objectContaining({
          id: 'request-2',
          decidedBy: 'synthetic-admin',
        }),
      ],
      page: 2,
      limit: 10,
      total: 1,
    });
    expect(logins).toEqual({
      items: [expect.objectContaining({ id: 'login-2', provider: 'github' })],
      page: 2,
      limit: 10,
      total: 1,
    });
    expect(staffAccessRequestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      }),
    );
    expect(loginFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ loginAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      }),
    );
  });
});

function syntheticSearchConditions() {
  const contains = { contains: 'synthetic', mode: 'insensitive' as const };
  // 이름의 정본은 프로필 행뿐이라 legacy fallback 갈래가 사라졌다.
  return [{ profile: { is: { name: contains } } }, { nickname: contains }];
}

type UserRowOptions = {
  readonly id: string;
  readonly role?: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  readonly accountStatus?: AccountStatus;
  readonly nickname?: string;
  readonly profile?: {
    readonly name: string;
    readonly studentId: string | null;
    readonly department: string;
    readonly memberKind?: MemberKind;
    readonly affiliationKind?: AffiliationKind;
    readonly affiliationName?: string;
  } | null;
  readonly pendingRequest?: {
    readonly id: string;
    readonly status: StaffAccessRequestStatus;
    readonly createdAt: Date;
  } | null;
  readonly lastLoginAt?: Date | null;
};

function userRow(options: UserRowOptions) {
  return {
    id: options.id,
    githubId: BigInt(`91${options.id.length}000001`),
    nickname: options.nickname ?? `synthetic-${options.id}`,
    profile: options.profile
      ? {
          memberKind: MemberKind.STUDENT,
          affiliationKind: AffiliationKind.DEPARTMENT,
          affiliationName: options.profile.department,
          ...options.profile,
        }
      : null,
    selectedMemberKind:
      options.role === 'ADMIN' ? null : (options.role ?? MemberKind.STUDENT),
    hasStaffAccess: options.role === 'STAFF',
    hasAdminAccess: options.role === 'ADMIN',
    accountStatus: options.accountStatus ?? AccountStatus.ACTIVE,
    staffAccessRequests: options.pendingRequest ? [options.pendingRequest] : [],
    loginHistories: options.lastLoginAt
      ? [{ loginAt: options.lastLoginAt }]
      : [],
  };
}
