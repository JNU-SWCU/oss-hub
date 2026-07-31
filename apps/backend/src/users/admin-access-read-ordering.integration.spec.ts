import { AccountStatus, Role } from '@prisma/client';
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
      name: 'Admin',
      profileName: null,
      role: Role.ADMIN,
    })
  ).githubId;
  await Promise.all([
    createUser({
      id: orderingUserIds.legacyAlpha,
      githubId: 8_003_900_001_002n,
      nickname: 'legacy-alpha',
      name: `Alpha ${queryFragment}`,
      profileName: null,
      role: Role.STUDENT,
    }),
    createUser({
      id: orderingUserIds.profileBravo,
      githubId: 8_003_900_001_003n,
      nickname: 'profile-bravo',
      name: `Bravo ${queryFragment}`,
      profileName: `Bravo ${queryFragment}`,
      role: Role.STUDENT,
    }),
    createUser({
      id: orderingUserIds.legacyCharlie,
      githubId: 8_003_900_001_004n,
      nickname: 'legacy-charlie',
      name: `Charlie ${queryFragment}`,
      profileName: null,
      role: Role.STUDENT,
    }),
    createUser({
      id: orderingUserIds.profileDelta,
      githubId: 8_003_900_001_005n,
      nickname: 'profile-delta',
      name: `Delta ${queryFragment}`,
      profileName: `Delta ${queryFragment}`,
      role: Role.STUDENT,
    }),
    createUser({
      id: orderingUserIds.profileEchoLogin,
      githubId: 8_003_900_001_006n,
      nickname: 'a-login',
      name: `Echo ${queryFragment}`,
      profileName: `Echo ${queryFragment}`,
      role: Role.STUDENT,
    }),
    createUser({
      id: orderingUserIds.profileEchoIdA,
      githubId: 8_003_900_001_007n,
      nickname: 'same-login',
      name: `Echo ${queryFragment}`,
      profileName: `Echo ${queryFragment}`,
      role: Role.STUDENT,
    }),
    createUser({
      id: orderingUserIds.profileEchoIdB,
      githubId: 8_003_900_001_008n,
      nickname: 'same-login',
      name: `Echo ${queryFragment}`,
      profileName: `Echo ${queryFragment}`,
      role: Role.STUDENT,
    }),
    createUser({
      id: orderingUserIds.profileZulu,
      githubId: 8_003_900_001_009n,
      nickname: 'profile-zulu',
      name: `Zulu ${queryFragment}`,
      profileName: `Zulu ${queryFragment}`,
      role: Role.STUDENT,
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
  readonly name: string | null;
  readonly profileName: string | null;
  readonly role: Role;
};

function createUser(input: SyntheticUser) {
  const profileStudentId = `${input.id}:student`;
  const profileDepartment = 'Synthetic department';
  return prisma.user.create({
    data: {
      id: input.id,
      githubId: input.githubId,
      nickname: input.nickname,
      name: input.name,
      role: input.role,
      accountStatus: AccountStatus.ACTIVE,
      ...(input.profileName === null
        ? {}
        : {
            studentId: profileStudentId,
            department: profileDepartment,
            profile: {
              create: {
                name: input.profileName,
                studentId: profileStudentId,
                department: profileDepartment,
              },
            },
          }),
    },
    select: { githubId: true },
  });
}
