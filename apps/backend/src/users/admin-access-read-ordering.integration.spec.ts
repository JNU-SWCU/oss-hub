import { writeApprovalFixture } from './user-history.integration-fixture';

import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { AffiliationKind, MemberKind } from './user-contract.config';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { UserHistoryRepository } from './user-history.repository';
import { PrismaService } from '../platform/prisma.service';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
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
const adminPrincipal = () => ({
  githubId: actorGithubId,
  memberKind: null,
  isProfileComplete: false,
  hasStaffAccess: false,
  hasAdminAccess: true,
  accountStatus: AccountStatus.ACTIVE,
});
beforeAll(async () => {
  await prisma.$connect();
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
  actorGithubId = (
    await createUser({
      id: `${prefix}actor`,
      githubId: 8003900001001n,
      nickname: 'synthetic-admin',
      profileName: null,
      role: 'ADMIN',
    })
  ).githubId;
  await Promise.all([
    createUser({
      id: orderingUserIds.legacyAlpha,
      githubId: 8003900001002n,
      nickname: 'legacy-alpha',
      profileName: `Alpha ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.profileBravo,
      githubId: 8003900001003n,
      nickname: 'profile-bravo',
      profileName: `Bravo ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.legacyCharlie,
      githubId: 8003900001004n,
      nickname: 'legacy-charlie',
      profileName: `Charlie ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.profileDelta,
      githubId: 8003900001005n,
      nickname: 'profile-delta',
      profileName: `Delta ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.profileEchoLogin,
      githubId: 8003900001006n,
      nickname: 'a-login',
      profileName: `Echo ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.profileEchoIdA,
      githubId: 8003900001007n,
      nickname: 'same-login',
      profileName: `Echo ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.profileEchoIdB,
      githubId: 8003900001008n,
      nickname: 'same-login',
      profileName: `Echo ${queryFragment}`,
      role: 'STUDENT',
    }),
    createUser({
      id: orderingUserIds.profileZulu,
      githubId: 8003900001009n,
      nickname: 'profile-zulu',
      profileName: `Zulu ${queryFragment}`,
      role: 'STUDENT',
    }),
  ]);
});
afterAll(async () => {
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
  await prisma.$disconnect();
});
it('orders profile and legacy display names across bounded pages without gaps or duplicates', async () => {
  const pages = await Promise.all(
    [1, 2, 3, 4].map((page) =>
      service.list(adminPrincipal(), {
        query: queryFragment,
        page,
        limit: pageLimit,
      }),
    ),
  );
  const returnedIds = pages.flatMap((page) =>
    page.items.map((item) => item.id),
  );
  expect(pages.map((page) => page.total)).toEqual([8, 8, 8, 8]);
  expect(returnedIds).toEqual(expectedUserIds);
  expect(new Set(returnedIds).size).toBe(expectedUserIds.length);
});
it('orders the pending request queue by request creation time, not account creation time', async () => {
  const olderAccountNewerRequest = await createUser({
    id: `${prefix}request-sort-older-account`,
    githubId: 8003900001010n,
    nickname: `older-account-${requestSortFragment}`,
    profileName: `Older account ${requestSortFragment}`,
    role: 'STUDENT',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
  });
  const newerAccountOlderRequest = await createUser({
    id: `${prefix}request-sort-newer-account`,
    githubId: 8003900001011n,
    nickname: `newer-account-${requestSortFragment}`,
    profileName: `Newer account ${requestSortFragment}`,
    role: 'STUDENT',
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
  });
  await (async () => {
    for (const request of [
      {
        id: `${olderAccountNewerRequest.id}:pending`,
        userId: olderAccountNewerRequest.id,
        status: 'PENDING' as const,
        createdAt: new Date('2026-08-02T00:00:00.000Z'),
      },
      {
        id: `${newerAccountOlderRequest.id}:pending`,
        userId: newerAccountOlderRequest.id,
        status: 'PENDING' as const,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ])
      await writeApprovalFixture(prisma, request);
  })();
  const page = await service.listRequests(adminPrincipal(), {
    query: requestSortFragment,
    sort: 'createdAt',
    direction: 'desc',
    page: 1,
    limit: 2,
  });
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
  readonly profileName: string | null;
  readonly role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  readonly createdAt?: Date;
};
function createUser(input: SyntheticUser) {
  const profileStudentId = String(input.githubId % 1000000n).padStart(6, '0');
  const profileDepartment = 'Synthetic department';
  return prisma.user.create({
    data: {
      id: input.id,
      githubId: input.githubId,
      nickname: input.nickname,
      accountStatus: AccountStatus.ACTIVE,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      ...(input.profileName === null
        ? {}
        : {
            name: input.profileName,
            studentId: profileStudentId,
            department: profileDepartment,
            type: MemberKind.STUDENT,
            departmentType: AffiliationKind.DEPARTMENT,
            profileCreatedAt: new Date(),
            profileUpdatedAt: new Date(),
          }),
      type:
        input.role === 'STUDENT'
          ? MemberKind.STUDENT
          : input.role === 'STAFF'
            ? MemberKind.STAFF
            : 'UNSELECTED',
      approvalStatus: input.role === 'STAFF' ? 'APPROVED' : 'NOT_REQUIRED',
      ...(input.role === 'ADMIN'
        ? { admin: { create: { origin: 'BOOTSTRAP' as const } } }
        : {}),
    },
    select: { id: true, githubId: true },
  });
}
