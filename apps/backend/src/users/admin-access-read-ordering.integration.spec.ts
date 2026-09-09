import { AccountStatus, AffiliationKind, MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const service = new AdminAccessService(
  new AdminAccessRepository(prisma),
  new AuditLogService(new AuditLogRepository(prisma)),
);
const prefix = 'test:pr03:admin-access-read-ordering:';
const queryFragment = 'synthetic-access-ordering';
const requestSortFragment = 'synthetic-request-created-at-ordering';
const pageLimit = 2;
const orderingUserIds = {
  legacyAlpha: `${prefix}legacy-alpha`,
  profileBravo: `${prefix}profile-bravo`,
  legacyCharlie: `${prefix}legacy-charlie`,
  profileDelta: `${prefix}profile-delta`,
  profileEchoLogin: `${prefix}profile-echo-login`,
  profileEchoIdA: `${prefix}profile-echo-id-a`,
  profileEchoIdB: `${prefix}profile-echo-id-b`,
  profileZulu: `${prefix}profile-zulu`,
} as const;
const expectedUserIds = [
  orderingUserIds.legacyAlpha,
  orderingUserIds.profileBravo,
  orderingUserIds.legacyCharlie,
  orderingUserIds.profileDelta,
  orderingUserIds.profileEchoLogin,
  orderingUserIds.profileEchoIdA,
  orderingUserIds.profileEchoIdB,
  orderingUserIds.profileZulu,
] as const;
let actorGithubId: bigint;

beforeAll(async () => {
  await prisma.$connect();
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  actorGithubId = (
    await createUser({
      id: `${prefix}actor`,
      githubId: 8_003_900_001_001n,
      nickname: 'synthetic-admin',
      profileName: null,
      role: 'ADMIN',
    })
  ).githubId;
  await Promise.all([
    createUser({
      id: orderingUserIds.legacyAlpha,
      githubId: 8_003_900_001_002n,
      nickname: 'legacy-alpha',
      profileName: `Alpha ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.profileBravo,
      githubId: 8_003_900_001_003n,
      nickname: 'profile-bravo',
      profileName: `Bravo ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.legacyCharlie,
      githubId: 8_003_900_001_004n,
      nickname: 'legacy-charlie',
      profileName: `Charlie ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.profileDelta,
      githubId: 8_003_900_001_005n,
      nickname: 'profile-delta',
      profileName: `Delta ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.profileEchoLogin,
      githubId: 8_003_900_001_006n,
      nickname: 'a-login',
      profileName: `Echo ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.profileEchoIdA,
      githubId: 8_003_900_001_007n,
      nickname: 'same-login',
      profileName: `Echo ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.profileEchoIdB,
      githubId: 8_003_900_001_008n,
      nickname: 'same-login',
      profileName: `Echo ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.profileZulu,
      githubId: 8_003_900_001_009n,
      nickname: 'profile-zulu',
      profileName: `Zulu ${queryFragment}`,
      role: 'STUDENT',
    }),
  ]);
});

afterAll(async () => {
  // 요청 행은 `User`를 cascade 없이 참조한다 — 먼저 지우지 않으면 사용자 삭제가 FK로 막힌다.
  await prisma.staffAccessRequest.deleteMany({
    where: { userId: { startsWith: prefix } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.$disconnect();
});

it('orders profile and legacy display names across bounded pages without gaps or duplicates', async () => {
  // Given
  const pages = await Promise.all(
    [1, 2, 3, 4].map((page) =>
      service.list(actorGithubId, {
        query: queryFragment,
        page,
        limit: pageLimit,
      }),
    ),
  );

  // When
  const returnedIds = pages.flatMap((page) =>
    page.items.map((item) => item.id),
  );

  // Then
  expect(pages.map((page) => page.total)).toEqual([8, 8, 8, 8]);
  expect(returnedIds).toEqual(expectedUserIds);
  expect(new Set(returnedIds).size).toBe(expectedUserIds.length);
});

it('orders the pending request queue by request creation time, not account creation time', async () => {
  // Given
  const olderAccountNewerRequest = await createUser({
    id: `${prefix}request-sort-older-account`,
    githubId: 8_003_900_001_010n,
    nickname: `older-account-${requestSortFragment}`,
    profileName: `Older account ${requestSortFragment}`,
    role: 'STUDENT',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
  });
  const newerAccountOlderRequest = await createUser({
    id: `${prefix}request-sort-newer-account`,
    githubId: 8_003_900_001_011n,
    nickname: `newer-account-${requestSortFragment}`,
    profileName: `Newer account ${requestSortFragment}`,
    role: 'STUDENT',
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
  });
  await prisma.staffAccessRequest.createMany({
    data: [
      {
        id: `${olderAccountNewerRequest.id}:pending`,
        userId: olderAccountNewerRequest.id,
        status: 'PENDING',
        createdAt: new Date('2026-08-02T00:00:00.000Z'),
      },
      {
        id: `${newerAccountOlderRequest.id}:pending`,
        userId: newerAccountOlderRequest.id,
        status: 'PENDING',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ],
  });

  // When
  const page = await service.listRequests(actorGithubId, {
    query: requestSortFragment,
    sort: 'createdAt',
    direction: 'desc',
    page: 1,
    limit: 2,
  });

  // Then
  expect(page.items.map((item) => item.id)).toEqual([
    olderAccountNewerRequest.id,
    newerAccountOlderRequest.id,
  ]);
  expect(page.items.map((item) => item.createdAt)).toEqual([
    new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-07-31T00:00:00.000Z'),
  ]);
  expect(page.items.map((item) => item.pendingRequest?.createdAt)).toEqual([
    new Date('2026-08-02T00:00:00.000Z'),
    new Date('2026-08-01T00:00:00.000Z'),
  ]);
});

type SyntheticUser = {
  readonly id: string;
  readonly githubId: bigint;
  readonly nickname: string;
  /**
   * 프로필 이름. `null`이면 프로필 행 자체를 만들지 않는다 — 아직 가입을 마치지
   * 않은 사람이다. 계약 스키마에서는 "행은 있는데 이름만 비어 있는" 상태가 없다.
   */
  readonly profileName: string | null;
  readonly role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  readonly createdAt?: Date;
};

function createUser(input: SyntheticUser) {
  const profileStudentId = String(input.githubId % 1_000_000n).padStart(6, '0');
  const profileDepartment = 'Synthetic department';
  return prisma.user.create({
    data: {
      id: input.id,
      githubId: input.githubId,
      nickname: input.nickname,
      accountStatus: AccountStatus.ACTIVE,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      selectedMemberKind:
        input.role === 'STUDENT'
          ? MemberKind.STUDENT
          : input.role === 'STAFF'
            ? MemberKind.STAFF
            : null,
      hasStaffAccess: input.role === 'STAFF',
      hasAdminAccess: input.role === 'ADMIN',
      ...(input.profileName === null
        ? {}
        : {
            profile: {
              create: {
                name: input.profileName,
                studentId: profileStudentId,
                department: profileDepartment,
                memberKind: MemberKind.STUDENT,
                affiliationKind: AffiliationKind.DEPARTMENT,
                affiliationName: profileDepartment,
              },
            },
          }),
    },
    select: { id: true, githubId: true },
  });
}
