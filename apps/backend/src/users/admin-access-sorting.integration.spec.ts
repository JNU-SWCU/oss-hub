import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { DepartmentType, MemberKind } from './user-contract.config';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AccountStatus, LoginHistoryEvent } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { UserHistoryRepository } from './user-history.repository';
import { PrismaService } from '../platform/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { UserProfileService } from './user-profile.service';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const service = new AdminAccessService(
  new AdminAccessRepository(
    prisma,
    new AdminAccessHistoryRepository(),
    new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
    new AdminRepository(prisma),
    new UserTransitionRepository(),
  ),
  new UserHistoryRepository(new UserTransitionRepository()),
  new AdminAccessMutationService(
    new HistoryMetadataService(),
    new UserProfileService(),
  ),
);
const prefix = 'test:pr04a:admin-access-sorting:';
const queryFragment = 'synthetic-pr04a-sort';
const ids = {
  alpha: `${prefix}a`,
  bravoProfile: `${prefix}b`,
  bravoLegacy: `${prefix}c`,
  unnamedWithLogin: `${prefix}d`,
  unnamedWithoutLogin: `${prefix}e`,
} as const;
const createdAt = {
  first: new Date('2026-07-01T00:00:00.000Z'),
  tied: new Date('2026-07-02T00:00:00.000Z'),
  third: new Date('2026-07-03T00:00:00.000Z'),
  fourth: new Date('2026-07-04T00:00:00.000Z'),
} as const;
const loginAt = {
  first: new Date('2026-07-11T00:00:00.000Z'),
  tied: new Date('2026-07-12T00:00:00.000Z'),
  third: new Date('2026-07-13T00:00:00.000Z'),
} as const;
const olderSuccessfulLoginAt = {
  alpha: new Date('2026-07-08T00:00:00.000Z'),
  tied: new Date('2026-07-10T00:00:00.000Z'),
  unnamed: new Date('2026-07-09T00:00:00.000Z'),
} as const;
const ignoredNoSuccessLoginAt = {
  failedLogin: new Date('2026-07-12T12:00:00.000Z'),
  successfulLogout: new Date('2026-07-11T12:00:00.000Z'),
} as const;
const expectedLastLoginAtById: ReadonlyMap<string, Date | null> = new Map([
  [ids.alpha, loginAt.third],
  [ids.bravoProfile, loginAt.tied],
  [ids.bravoLegacy, loginAt.tied],
  [ids.unnamedWithLogin, loginAt.first],
  [ids.unnamedWithoutLogin, null],
]);
let actorGithubId: bigint;
const adminPrincipal = () => ({
  githubId: actorGithubId,
  memberKind: null,
  isProfileComplete: false,
  hasStaffAccess: false,
  hasAdminAccess: true,
  accountStatus: AccountStatus.ACTIVE,
});
async function cleanup(): Promise<void> {
  await prisma.loginHistory.deleteMany({
    where: { userId: { startsWith: prefix } },
  });
  await prisma.user.updateMany({
    where: { id: { startsWith: prefix } },
    data: {
      name: null,
      studentId: null,
      staffNumber: null,
      department: null,
      departmentType: null,
      profileCreatedAt: null,
      profileUpdatedAt: null,
      phone: null,
      type: 'UNSELECTED',
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
    },
  });
}
beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
  actorGithubId = (
    await prisma.user.create({
      data: {
        id: `${prefix}actor`,
        githubId: 8004000001001n,
        nickname: 'synthetic-pr04a-admin',
        accountStatus: AccountStatus.ACTIVE,
        admin: { create: { origin: 'BOOTSTRAP' } },
      },
      select: { githubId: true },
    })
  ).githubId;
  await Promise.all([
    createSortingUser({
      id: ids.alpha,
      githubId: 8004000001002n,
      legacyName: `Alpha ${queryFragment}`,
      profileName: `Alpha ${queryFragment}`,
      createdAt: createdAt.first,
      lastLoginAt: loginAt.third,
      olderSuccessfulLoginAt: olderSuccessfulLoginAt.alpha,
      studentId: '704001',
    }),
    createSortingUser({
      id: ids.bravoProfile,
      githubId: 8004000001003n,
      legacyName: `Zulu ${queryFragment}`,
      profileName: `Bravo ${queryFragment}`,
      createdAt: createdAt.tied,
      lastLoginAt: loginAt.tied,
      olderSuccessfulLoginAt: olderSuccessfulLoginAt.tied,
      studentId: '704002',
    }),
    createSortingUser({
      id: ids.bravoLegacy,
      githubId: 8004000001004n,
      legacyName: `Bravo ${queryFragment}`,
      profileName: `Bravo ${queryFragment}`,
      createdAt: createdAt.tied,
      lastLoginAt: loginAt.tied,
      olderSuccessfulLoginAt: olderSuccessfulLoginAt.tied,
      studentId: '704003',
    }),
    createSortingUser({
      id: ids.unnamedWithLogin,
      githubId: 8004000001005n,
      legacyName: null,
      profileName: null,
      createdAt: createdAt.third,
      lastLoginAt: loginAt.first,
      olderSuccessfulLoginAt: olderSuccessfulLoginAt.unnamed,
      studentId: '704004',
    }),
    createSortingUser({
      id: ids.unnamedWithoutLogin,
      githubId: 8004000001006n,
      legacyName: null,
      profileName: null,
      createdAt: createdAt.fourth,
      lastLoginAt: null,
      olderSuccessfulLoginAt: null,
      studentId: '704005',
    }),
  ]);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
it.each([
  ['name asc', 'name', 'asc', 'abcde'],
  ['name desc', 'name', 'desc', 'cbaed'],
  ['createdAt asc', 'createdAt', 'asc', 'abcde'],
  ['createdAt desc', 'createdAt', 'desc', 'edcba'],
  ['lastLoginAt asc', 'lastLoginAt', 'asc', 'dbcae'],
  ['lastLoginAt desc', 'lastLoginAt', 'desc', 'acbde'],
] as const)(
  'orders %s across tied pages without gaps or duplicates and keeps nulls last',
  async (_label, sort, direction, expectedOrder) => {
    const expectedIds = [...expectedOrder].map(
      (suffix) => `${prefix}${suffix}`,
    );
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        service.list(adminPrincipal(), {
          query: queryFragment,
          page,
          limit: 2,
          sort,
          direction,
        }),
      ),
    );
    const returnedItems = pages.flatMap((page) => page.items);
    const returnedIds = returnedItems.map((item) => item.id);
    expect(pages.map((page) => page.total)).toEqual([5, 5, 5]);
    expect(returnedIds).toEqual(expectedIds);
    expect(new Set(returnedIds).size).toBe(expectedIds.length);
    expect(
      returnedItems.map(({ id, lastLoginAt }) => [id, lastLoginAt]),
    ).toEqual(expectedIds.map((id) => [id, expectedLastLoginAtById.get(id)]));
    if (sort === 'lastLoginAt') {
      expect(returnedItems.at(-1)).toMatchObject({
        id: ids.unnamedWithoutLogin,
        lastLoginAt: null,
      });
    }
    expect(
      returnedItems.find((item) => item.id === ids.bravoProfile),
    ).toMatchObject({
      name: `Bravo ${queryFragment}`,
      lastLoginAt: loginAt.tied,
    });
  },
);
type SortingUserInput = {
  readonly id: string;
  readonly githubId: bigint;
  readonly legacyName: string | null;
  readonly profileName: string | null;
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
  readonly olderSuccessfulLoginAt: Date | null;
  readonly studentId: string;
};
function createSortingUser(input: SortingUserInput) {
  const department = 'Synthetic department';
  return prisma.user.create({
    data: {
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
      id: input.id,
      githubId: input.githubId,
      nickname: `${queryFragment}-${input.id.at(-1)}`,
      createdAt: input.createdAt,
      accountStatus: AccountStatus.ACTIVE,
      ...(input.profileName === null
        ? {}
        : {
            name: input.profileName,
            studentId: input.studentId,
            department,
            type: MemberKind.STUDENT,
            departmentType: DepartmentType.DEPARTMENT,
            profileCreatedAt: new Date(),
            profileUpdatedAt: new Date(),
          }),
      loginHistories: { create: loginHistoryFixtures(input) },
      type: MemberKind.STUDENT,
      approvalStatus: 'NOT_REQUIRED',
    },
  });
}
function loginHistoryFixtures(input: SortingUserInput) {
  const selected = input.lastLoginAt;
  const older = input.olderSuccessfulLoginAt;
  const rows: ReadonlyArray<
    readonly [string, LoginHistoryEvent, boolean, Date]
  > =
    selected === null || older === null
      ? [
          [
            'failed-login',
            LoginHistoryEvent.LOGIN,
            false,
            ignoredNoSuccessLoginAt.failedLogin,
          ],
          [
            'successful-logout',
            LoginHistoryEvent.LOGOUT,
            true,
            ignoredNoSuccessLoginAt.successfulLogout,
          ],
        ]
      : [
          ['older-login', LoginHistoryEvent.LOGIN, true, older],
          ['selected-login', LoginHistoryEvent.LOGIN, true, selected],
          [
            'newer-failed-login',
            LoginHistoryEvent.LOGIN,
            false,
            new Date(selected.getTime() + 1),
          ],
          [
            'newer-logout',
            LoginHistoryEvent.LOGOUT,
            true,
            new Date(selected.getTime() + 2),
          ],
        ];
  return rows.map(([suffix, event, success, loginAt]) => ({
    id: `${input.id}:${suffix}`,
    event,
    success,
    loginAt,
  }));
}
