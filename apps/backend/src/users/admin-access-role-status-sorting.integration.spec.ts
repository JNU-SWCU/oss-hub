import { canonicalUserCreate } from './canonical-user-fixture';
import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { MemberKind } from './user-contract.config';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { UserHistoryRepository } from './user-history.repository';
import { PrismaService } from '../platform/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { type AdminAccessSortDirection } from './admin-access-read-ordering.repository';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
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
    new AuditLogMetadataService(),
    new UserProfileService(),
  ),
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
const adminPrincipal = () => ({
  githubId: actorGithubId,
  memberKind: null,
  isProfileComplete: false,
  hasStaffAccess: false,
  hasAdminAccess: true,
  accountStatus: AccountStatus.ACTIVE,
});
async function cleanup(): Promise<void> {
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
        githubId: 8014000001001n,
        nickname: 'synthetic-role-status-admin',
        accountStatus: AccountStatus.ACTIVE,
        admin: { create: { origin: 'BOOTSTRAP' } },
      },
      select: { githubId: true },
    })
  ).githubId;
  await Promise.all([
    createListedUser({
      id: ids.unassigned,
      githubId: 8014000001002n,
      role: null,
      accountStatus: AccountStatus.ACTIVE,
    }),
    createListedUser({
      id: ids.student,
      githubId: 8014000001003n,
      memberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
    }),
    createListedUser({
      id: ids.staff,
      githubId: 8014000001004n,
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    }),
    createListedUser({
      id: ids.admin,
      githubId: 8014000001005n,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    }),
    createListedUser({
      id: ids.activeA,
      githubId: 8014000001006n,
      memberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      nameSuffix: 'active-a',
    }),
    createListedUser({
      id: ids.activeB,
      githubId: 8014000001007n,
      memberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      nameSuffix: 'active-b',
    }),
    createListedUser({
      id: ids.deactivatedA,
      githubId: 8014000001008n,
      memberKind: MemberKind.STUDENT,
      accountStatus: AccountStatus.DEACTIVATED,
      nameSuffix: 'deactivated-a',
    }),
    createListedUser({
      id: ids.deactivatedB,
      githubId: 8014000001009n,
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
    const page = await service.list(adminPrincipal(), {
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
    const page = await service.list(adminPrincipal(), {
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
    data: canonicalUserCreate({
      id: input.id,
      githubId: input.githubId,
      nickname: `${queryFragment} ${input.nameSuffix === undefined ? 'role' : 'status'} ${nameSuffix}`,
      accountStatus: input.accountStatus,
      memberKind: input.memberKind ?? null,
      hasStaffAccess: input.hasStaffAccess ?? false,
      hasAdminAccess: input.hasAdminAccess ?? false,
      name: `${queryFragment}-${nameSuffix}`,
      department,
    }),
  });
}
