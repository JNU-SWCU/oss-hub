import {
  userAuditRows,
  writeApprovalFixture,
  requestHistory,
} from './user-history.integration-fixture';

import { flatProfileFixture } from './canonical-user-fixture';
import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import {
  AffiliationKind,
  MemberKind,
  StaffAccessRequestStatus,
} from './user-contract.config';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { UserHistoryRepository } from './user-history.repository';
import { PrismaService } from '../platform/prisma.service';
import { RolesErrorCode } from './roles-error-code.error';
import { FailingDecisionAdminAccessRepository } from './admin-access.integration-support';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { ADMIN_ACCESS_REQUEST_DECISIONS } from './admin-access-query.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { UserProfileService } from './user-profile.service';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
let sequence = 0;
beforeAll(async () => {
  await prisma.$connect();
});
afterAll(() => prisma.$disconnect());
it('rolls back the user CAS when the pending-request CAS fails second', async () => {
  const actor = await createUser('ADMIN', 'actor');
  const target = await createUser(null, 'target');
  const profile = {
    name: '합성 롤백 대상',
    studentId: `${810000 + sequence}`,
    department: '소프트웨어공학과',
    memberKind: MemberKind.STUDENT,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: '소프트웨어공학과',
  };
  await prisma.user.update({
    where: { id: target.id },
    data: {
      ...flatProfileFixture(profile),
      profileCreatedAt: new Date(),
      profileUpdatedAt: new Date(),
    },
  });
  const request = await writeApprovalFixture(prisma, {
    id: `${target.id}:request`,
    userId: target.id,
  });
  const realRepository = new AdminAccessRepository(
    prisma,
    new AdminAccessHistoryRepository(),
    new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
    new AdminRepository(prisma),
    new UserTransitionRepository(),
  );
  const service = new AdminAccessService(
    new FailingDecisionAdminAccessRepository(realRepository),
    new UserHistoryRepository(new UserTransitionRepository()),
    new AdminAccessMutationService(
      new AuditLogMetadataService(),
      new UserProfileService(),
    ),
  );
  await expect(
    service.patchAccess(actor.githubId, target.id, {
      expectedRole: null,
      desiredRole: 'STAFF',
      expectedAccountStatus: AccountStatus.ACTIVE,
      desiredAccountStatus: AccountStatus.ACTIVE,
      expectedPendingRequest: {
        id: request.id,
        status: StaffAccessRequestStatus.PENDING,
      },
      requestDecision: {
        decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE,
      },
    }),
  ).rejects.toMatchObject({
    errorCode: { code: RolesErrorCode.ACCESS_STATE_MISMATCH, status: 409 },
  });
  await expect(
    prisma.user.findUniqueOrThrow({
      include: { admin: true },
      where: { id: target.id },
    }),
  ).resolves.toMatchObject({
    approvalStatus: 'PENDING',
    admin: null,
    accountStatus: AccountStatus.ACTIVE,
  });
  await expect(
    requestHistory(prisma)
      .then((rows) => rows.filter((row) => row.id === request.id))
      .then((rows) => {
        const row = rows[0];
        if (!row) throw new TypeError('Expected request history fixture');
        return row;
      }),
  ).resolves.toMatchObject({
    status: StaffAccessRequestStatus.PENDING,
    decidedById: null,
  });
  await expect(
    userAuditRows(prisma, { targetId: request.id }).then((rows) => rows.length),
  ).resolves.toBe(0);
});
async function createUser(
  role: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
  label: string,
) {
  sequence += 1;
  return prisma.user.create({
    data: canonicalUserCreateFromLabel(role, {
      id: `test:pr03:admin-access-rollback:${label}:${sequence}`,
      githubId: 9003700000n + BigInt(sequence),
      nickname: `synthetic-${label}-${sequence}`,
    }),
    select: { id: true, githubId: true },
  });
}
