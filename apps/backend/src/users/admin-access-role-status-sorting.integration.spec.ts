import { AccountStatus, MemberKind } from '@prisma/client';
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
      selectedMemberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
    }),
    createListedUser({
      id: ids.staff,
      githubId: 8_014_000_001_004n,
      selectedMemberKind: MemberKind.STAFF,
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
      selectedMemberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      nameSuffix: 'active-a',
    }),
    createListedUser({
      id: ids.activeB,
      githubId: 8_014_000_001_007n,
      selectedMemberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      nameSuffix: 'active-b',
    }),
    createListedUser({
      id: ids.deactivatedA,
      githubId: 8_014_000_001_008n,
      selectedMemberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.DEACTIVATED,
      nameSuffix: 'deactivated-a',
    }),
    createListedUser({
      id: ids.deactivatedB,
      githubId: 8_014_000_001_009n,
      selectedMemberKind: MemberKind.STUDENT,
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

function createListedUser(input: {
  readonly id: string;
  readonly githubId: bigint;
  readonly role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  readonly accountStatus: AccountStatus;
  readonly nameSuffix?: string;
}) {
  const nameSuffix = input.nameSuffix ?? input.id.slice(prefix.length);
  return prisma.user.create({
    data: {
      id: input.id,
      githubId: input.githubId,
      nickname: `${queryFragment}-${nameSuffix}`,
      name: `${queryFragment} ${nameSuffix.startsWith('active') || nameSuffix.startsWith('deactivated') ? 'status' : 'role'} ${nameSuffix}`,
      role: input.role,
      accountStatus: input.accountStatus,
    },
  });
}
