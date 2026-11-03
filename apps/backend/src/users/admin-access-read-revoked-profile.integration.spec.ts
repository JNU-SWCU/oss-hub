import { writeApprovalFixture } from './user-history.integration-fixture';

import {
  AffiliationKind,
  MemberKind,
  StaffAccessRequestStatus,
} from './user-contract.config';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import {
  ADMIN_ACCESS_DEFAULT_DIRECTION,
  ADMIN_ACCESS_DEFAULT_SORT,
} from './admin-access-query.config';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserProfileService } from './user-profile.service';
const mutation = new AdminAccessMutationService(
  new AuditLogMetadataService(),
  new UserProfileService(),
);
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const prefix = 'test:184:admin-read:';
const REVOKED_STAFF_ID = `${prefix}revoked-staff`;
const UNCHOSEN_ID = `${prefix}unchosen`;
const APPROVED_AT = new Date('2026-02-01T00:00:00.000Z');
const REVOKED_AT = new Date('2026-02-02T00:00:00.000Z');
beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
  await prisma.user.create({
    data: {
      id: REVOKED_STAFF_ID,
      githubId: 9184100001n,
      nickname: 'synthetic-184-revoked-staff',
      accountStatus: AccountStatus.ACTIVE,
      name: '합성 회수 교직원',
      studentId: null,
      department: '합성 사업단',
      departmentType: AffiliationKind.PROGRAM_OFFICE,
      profileCreatedAt: new Date(),
      profileUpdatedAt: new Date(),
      type: MemberKind.STAFF,
      approvalStatus: 'PENDING',
    },
  });
  await (async () => {
    for (const request of [
      {
        userId: REVOKED_STAFF_ID,
        status: StaffAccessRequestStatus.APPROVED,
        createdAt: APPROVED_AT,
        decidedAt: APPROVED_AT,
      },
      {
        userId: REVOKED_STAFF_ID,
        status: StaffAccessRequestStatus.REVOKED,
        createdAt: REVOKED_AT,
        decidedAt: REVOKED_AT,
      },
    ])
      await writeApprovalFixture(prisma, request);
  })();
  await prisma.user.create({
    data: {
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
      id: UNCHOSEN_ID,
      githubId: 9184100002n,
      nickname: 'synthetic-184-unchosen',
      accountStatus: AccountStatus.ACTIVE,
      type: 'UNSELECTED',
      approvalStatus: 'NOT_REQUIRED',
    },
  });
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
it('상세 조회에서 회수된 교직원의 프로필은 완료로 읽힌다', async () => {
  const row = await new AdminAccessReadRepository(
    new AdminAccessReadOrderingRepository(),
  ).findAdminAccessUserById(prisma, REVOKED_STAFF_ID);
  if (!row) throw new TypeError('Expected fixture user');
  const detail = mutation.toAdminAccessUserDetailRecord(row);
  expect(detail?.role).toBeNull();
  expect(detail?.profile.studentId).toBeNull();
  expect(detail?.isProfileComplete).toBe(true);
  expect(detail?.profile.isComplete).toBe(true);
  expect(detail?.pendingRequest).toBeNull();
});
it('고른 역할이 없는 미배정 사용자는 여전히 학생 기준으로 미완료다', async () => {
  const row = await new AdminAccessReadRepository(
    new AdminAccessReadOrderingRepository(),
  ).findAdminAccessUserById(prisma, UNCHOSEN_ID);
  if (!row) throw new TypeError('Expected fixture user');
  const detail = mutation.toAdminAccessUserDetailRecord(row);
  expect(detail?.isProfileComplete).toBe(false);
});
it('목록 조회도 상세와 같은 완료 판정을 돌려준다', async () => {
  const page = await new AdminAccessReadRepository(
    new AdminAccessReadOrderingRepository(),
  ).listAdminAccessUsers(prisma, {
    page: 1,
    limit: 50,
    query: 'synthetic-184-',
    sort: ADMIN_ACCESS_DEFAULT_SORT,
    direction: ADMIN_ACCESS_DEFAULT_DIRECTION,
  });
  const completeById = new Map(
    page.items.map(
      (item) =>
        [
          item.id,
          mutation.toAdminAccessUserRecord(item).isProfileComplete,
        ] as const,
    ),
  );
  expect(completeById.get(REVOKED_STAFF_ID)).toBe(true);
  expect(completeById.get(UNCHOSEN_ID)).toBe(false);
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
