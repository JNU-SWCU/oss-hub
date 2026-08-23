import { AccountStatus, AffiliationKind, MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import type { AdminAccessSortDirection } from './domain/admin-access';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const service = new AdminAccessService(
  new AdminAccessRepository(prisma),
  new AuditLogService(new AuditLogRepository(prisma)),
);
const prefix = 'test:admin-access-role-status-sort:';
const queryFragment = 'synthetic-role-status-sort';
const ids = {
  unassigned: `${prefix}unassigned`,
  student: `${prefix}student`,
  staff: `${prefix}staff`,
  admin: `${prefix}admin`,
  activeA: `${prefix}active-a`,
  activeB: `${prefix}active-b`,
  deactivatedA: `${prefix}deactivated-a`,
  deactivatedB: `${prefix}deactivated-b`,
} as const;
let actorGithubId: bigint;

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
  actorGithubId = (
    await prisma.user.create({
      data: {
        id: `${prefix}actor`,
        githubId: 8_014_000_001_001n,
        nickname: 'synthetic-role-status-admin',
        hasAdminAccess: true,
        accountStatus: AccountStatus.ACTIVE,
      },
      select: { githubId: true },
    })
  ).githubId;
  await Promise.all([
    createListedUser({
      id: ids.unassigned,
      githubId: 8_014_000_001_002n,
      role: null,
      accountStatus: AccountStatus.ACTIVE,
    }),
    createListedUser({
      id: ids.student,
      githubId: 8_014_000_001_003n,
      memberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
    }),
    createListedUser({
      id: ids.staff,
      githubId: 8_014_000_001_004n,
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    }),
    createListedUser({
      id: ids.admin,
      githubId: 8_014_000_001_005n,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    }),
    createListedUser({
      id: ids.activeA,
      githubId: 8_014_000_001_006n,
      memberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      nameSuffix: 'active-a',
    }),
    createListedUser({
      id: ids.activeB,
      githubId: 8_014_000_001_007n,
      memberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      nameSuffix: 'active-b',
    }),
    createListedUser({
      id: ids.deactivatedA,
      githubId: 8_014_000_001_008n,
      memberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.DEACTIVATED,
      nameSuffix: 'deactivated-a',
    }),
    createListedUser({
      id: ids.deactivatedB,
      githubId: 8_014_000_001_009n,
      memberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.DEACTIVATED,
      nameSuffix: 'deactivated-b',
    }),
  ]);
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

it.each([
  ['asc', [ids.unassigned, ids.student, ids.staff, ids.admin]],
  ['desc', [ids.admin, ids.staff, ids.student, ids.unassigned]],
] as const)(
  'orders role %s as unassigned then student then staff then admin',
  async (direction: AdminAccessSortDirection, expectedIds) => {
    const page = await service.list(actorGithubId, {
      query: `${queryFragment} role`,
      page: 1,
      limit: 10,
      sort: 'role',
      direction,
    });

    expect(page.items.map((item) => item.id)).toEqual(expectedIds);
  },
);

it.each([
  ['asc', [ids.activeA, ids.activeB, ids.deactivatedA, ids.deactivatedB]],
  ['desc', [ids.deactivatedB, ids.deactivatedA, ids.activeB, ids.activeA]],
] as const)(
  'orders accountStatus %s as active then deactivated with id tie-break',
  async (direction: AdminAccessSortDirection, expectedIds) => {
    const page = await service.list(actorGithubId, {
      query: `${queryFragment} status`,
      page: 1,
      limit: 10,
      sort: 'accountStatus',
      direction,
    });

    expect(page.items.map((item) => item.id)).toEqual(expectedIds);
  },
);

/**
 * 목록 정렬 픽스처. 표시 역할은 세 canonical 사실에서 파생되므로
 * (`users/domain/authority-label.ts`) 여기서도 그 세 값을 각각 받는다.
 *
 * `memberKind`가 있으면 프로필 행까지 만든다 — 목록이 이름으로 정렬·검색하려면
 * 그 행이 있어야 한다.
 */
function createListedUser(input: {
  readonly id: string;
  readonly githubId: bigint;
  readonly memberKind?: MemberKind;
  readonly hasStaffAccess?: boolean;
  readonly hasAdminAccess?: boolean;
  readonly role?: null;
  readonly accountStatus: AccountStatus;
  readonly nameSuffix?: string;
}) {
  const nameSuffix = input.nameSuffix ?? input.id.slice(prefix.length);
  const department = 'Synthetic department';
  return prisma.user.create({
    data: {
      id: input.id,
      githubId: input.githubId,
      nickname: `${queryFragment} ${input.nameSuffix === undefined ? 'role' : 'status'} ${nameSuffix}`,
      accountStatus: input.accountStatus,
      selectedMemberKind: input.memberKind ?? null,
      hasStaffAccess: input.hasStaffAccess ?? false,
      hasAdminAccess: input.hasAdminAccess ?? false,
      ...(input.memberKind === undefined
        ? {}
        : {
            profile: {
              create: {
                name: `${queryFragment}-${nameSuffix}`,
                studentId:
                  input.memberKind === MemberKind.STUDENT
                    ? `${input.githubId % 1000000n}`.padStart(6, '0')
                    : null,
                department,
                memberKind: input.memberKind,
                affiliationKind:
                  input.memberKind === MemberKind.STUDENT
                    ? AffiliationKind.DEPARTMENT
                    : AffiliationKind.PROGRAM_OFFICE,
                affiliationName: department,
              },
            },
          }),
    },
  });
}
