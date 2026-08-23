import { AccountStatus, LoginHistoryEvent, MemberKind } from '@prisma/client';
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

async function cleanup(): Promise<void> {
  await prisma.loginHistory.deleteMany({
    where: { userId: { startsWith: prefix } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
  actorGithubId = (
    await prisma.user.create({
      data: {
        id: `${prefix}actor`,
        githubId: 8_004_000_001_001n,
        nickname: 'synthetic-pr04a-admin',
        hasAdminAccess: true,
        accountStatus: AccountStatus.ACTIVE,
      },
      select: { githubId: true },
    })
  ).githubId;
  await Promise.all([
    createSortingUser({
      id: ids.alpha,
      githubId: 8_004_000_001_002n,
      legacyName: `Alpha ${queryFragment}`,
      profileName: null,
      createdAt: createdAt.first,
      lastLoginAt: loginAt.third,
      olderSuccessfulLoginAt: olderSuccessfulLoginAt.alpha,
      studentId: '704001',
    }),
    createSortingUser({
      id: ids.bravoProfile,
      githubId: 8_004_000_001_003n,
      legacyName: `Zulu ${queryFragment}`,
      profileName: `Bravo ${queryFragment}`,
      createdAt: createdAt.tied,
      lastLoginAt: loginAt.tied,
      olderSuccessfulLoginAt: olderSuccessfulLoginAt.tied,
      studentId: '704002',
    }),
    createSortingUser({
      id: ids.bravoLegacy,
      githubId: 8_004_000_001_004n,
      legacyName: `Bravo ${queryFragment}`,
      profileName: null,
      createdAt: createdAt.tied,
      lastLoginAt: loginAt.tied,
      olderSuccessfulLoginAt: olderSuccessfulLoginAt.tied,
      studentId: '704003',
    }),
    createSortingUser({
      id: ids.unnamedWithLogin,
      githubId: 8_004_000_001_005n,
      legacyName: null,
      profileName: null,
      createdAt: createdAt.third,
      lastLoginAt: loginAt.first,
      olderSuccessfulLoginAt: olderSuccessfulLoginAt.unnamed,
      studentId: '704004',
    }),
    createSortingUser({
      id: ids.unnamedWithoutLogin,
      githubId: 8_004_000_001_006n,
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
    // Given
    const expectedIds = [...expectedOrder].map(
      (suffix) => `${prefix}${suffix}`,
    );

    // When
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        service.list(actorGithubId, {
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

    // Then
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
      id: input.id,
      githubId: input.githubId,
      nickname: `${queryFragment}-${input.id.at(-1)}`,
      createdAt: input.createdAt,
      selectedMemberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      ...(input.profileName === null
        ? {}
        : {
            studentId: input.studentId,
            department,
            profile: {
              create: {
                name: input.profileName,
                studentId: input.studentId,
                department,
              },
            },
          }),
      loginHistories: { create: loginHistoryFixtures(input) },
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
