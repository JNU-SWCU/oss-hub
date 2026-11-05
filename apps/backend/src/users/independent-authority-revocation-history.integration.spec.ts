import {
  writeApprovalFixture,
  requestHistory,
} from './user-history.integration-fixture';

import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { StaffAccessRequestStatus } from './user-contract.config';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AccountStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { UserHistoryRepository } from './user-history.repository';
import type { ConsentsService } from './consents.service';
import { PrismaService } from '../platform/prisma.service';
import { MemberOnboardingRepository } from './member-onboarding.repository';
import { MemberOnboardingService } from './member-onboarding.service';
import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { IndependentAuthorityRepository } from './independent-authority.repository';
import { STAFF_ACCESS_COMMANDS } from './admin-access-query.config';
import { IndependentAuthorityService } from './independent-authority.service';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { UserProfileService } from './user-profile.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const prisma = new PrismaService();
const authority = new IndependentAuthorityService(
  new IndependentAuthorityRepository(
    prisma,
    new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
    new AdminAccessRepository(
      prisma,
      new AdminAccessHistoryRepository(),
      new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
      new AdminRepository(prisma),
      new UserTransitionRepository(),
    ),
    new AdminRepository(prisma),
  ),
  new UserHistoryRepository(new UserTransitionRepository()),
  new HistoryMetadataService(),
  new AdminAccessMutationService(
    new HistoryMetadataService(),
    new UserProfileService(),
  ),
  new UserProfileService(),
);
const consentsService: Pick<ConsentsService, 'requireCurrent'> = {
  requireCurrent: jest.fn().mockResolvedValue(undefined),
};
const roles = new MemberOnboardingService(
  new MemberOnboardingRepository(prisma, new UserTransitionRepository()),
  consentsService,
  new UserProfileService(),
);
const TEST_PREFIX = 'test:1383:independent-authority-revocation:';
const GITHUB_ID_BASE = 9013830000n;
let sequence = 0;
beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
it('화면이 쓰는 회수 API는 REVOKED 행을 남겨 당사자를 역할 선택으로 되돌린다', async () => {
  const actor = await createUser('recovery-actor', 'ADMIN');
  const target = await createUser('recovery-target', 'STAFF');
  const approved = await writeApprovalFixture(prisma, {
    userId: target.id,
    status: StaffAccessRequestStatus.APPROVED,
    decidedById: actor.id,
    decidedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  await authority.patchStaffAccess(actor.githubId, target.id, {
    command: STAFF_ACCESS_COMMANDS.REVOKE,
  });
  await expect(
    prisma.user.findUniqueOrThrow({
      include: { admin: true },
      where: { id: target.id },
    }),
  ).resolves.toMatchObject({ approvalStatus: 'REVOKED' });
  const requests = await requestHistory(prisma, target.id);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    id: approved.id,
    status: StaffAccessRequestStatus.REVOKED,
  });
  expect(requests[0]).toMatchObject({
    status: StaffAccessRequestStatus.REVOKED,
    decidedById: actor.id,
    rejectionReason: null,
  });
  expect(requests[0]?.decidedAt).not.toBeNull();
  await expect(
    authority.patchStaffAccess(actor.githubId, target.id, {
      command: STAFF_ACCESS_COMMANDS.REVOKE,
    }),
  ).rejects.toMatchObject({
    errorCode: { code: 'ROL_013', status: 409 },
  });
  await expect(
    requestHistory(prisma, target.id)
      .then((rows) =>
        rows.filter((row) => row.status === StaffAccessRequestStatus.REVOKED),
      )
      .then((rows) => rows.length),
  ).resolves.toBe(1);
  await expect(roles.getMyRequest(target.githubId)).resolves.toMatchObject({
    status: StaffAccessRequestStatus.REVOKED,
  });
  await expect(roles.retryStaffRequest(target.githubId)).resolves.toMatchObject(
    { status: StaffAccessRequestStatus.PENDING },
  );
});
function createUser(label: string, role: 'STAFF' | 'ADMIN') {
  sequence += 1;
  return prisma.user.create({
    data: canonicalUserCreateFromLabel(role, {
      id: `${TEST_PREFIX}${label}:${sequence}`,
      githubId: GITHUB_ID_BASE + BigInt(sequence),
      nickname: `synthetic-1383-${label}-${sequence}`,
      accountStatus: AccountStatus.ACTIVE,
    }),
    select: { id: true, githubId: true },
  });
}
