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
    select: { githubId: true },
  });
}
