import { userAuditRows } from './user-history.integration-fixture';

import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { AffiliationKind, MemberKind } from './user-contract.config';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { AdminAccessReadRepository } from './admin-access-read.repository';
import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import { AdminAccessRepository } from './admin-access.repository';
import { Prisma } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { USER_PROFILE_AUDIT_ACTIONS } from '../platform/audit-log-metadata.config';
import { UserHistoryRepository } from './user-history.repository';
import { DomainException } from '../platform/error-code.error';
import { PrismaService } from '../platform/prisma.service';
import { AdminProfileRepository } from './admin-profile.repository';
import { AdminProfileMutationService } from './admin-profile-mutation.service';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.error';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserProfileService } from './user-profile.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const DATABASE_CONNECTION_TIMEOUT_MS = 60000;
const TEST_PREFIX = 'test:qa58:admin-profile-p2034:';
const TARGET_PREFIX = `${TEST_PREFIX}target:`;
const GITHUB_ID_BASE = 9058000000n;
const prisma = new PrismaService();
const repository = new AdminProfileRepository(
  prisma,
  new AdminAccessRepository(
    prisma,
    new AdminAccessHistoryRepository(),
    new AdminAccessReadRepository(new AdminAccessReadOrderingRepository()),
    new AdminRepository(prisma),
    new UserTransitionRepository(),
  ),
  new PrismaSerializationRetryRepository(),
  new UserTransitionRepository(),
);
const auditLog = new UserHistoryRepository(new UserTransitionRepository());
let sequence = 0;
async function createTargetUser(): Promise<string> {
  sequence += 1;
  const id = `${TARGET_PREFIX}${sequence}`;
  await prisma.user.create({
    data: {
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
      approvalRequestedAt: null,
      approvalDecidedAt: null,
      approvalDecidedById: null,
      approvalReason: null,
      id,
      githubId: GITHUB_ID_BASE + BigInt(sequence),
      nickname: `synthetic-qa58-target-${sequence}`,
      name: '합성 초기 이름',
      studentId: `${920000 + sequence}`,
      department: '합성 학과',
      type: MemberKind.STUDENT,
      departmentType: AffiliationKind.DEPARTMENT,
      profileCreatedAt: new Date(),
      profileUpdatedAt: new Date(),
    },
  });
  return id;
}
async function createAdminActor(label: string): Promise<{
  readonly githubId: bigint;
  readonly name: string;
}> {
  sequence += 1;
  const name = `관리자 ${label}`;
  const created = await prisma.user.create({
    data: {
      id: `${TEST_PREFIX}actor-${label}:${sequence}`,
      githubId: GITHUB_ID_BASE + 100000n + BigInt(sequence),
      nickname: `synthetic-qa58-actor-${label}-${sequence}`,
      admin: { create: { origin: 'BOOTSTRAP' } },
    },
    select: { githubId: true },
  });
  return { githubId: created.githubId, name };
}
describe('AdminProfileRepository P2034 직렬화 충돌 재시도 (QA58)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it('서로 다른 필드를 동시에 고치는 두 관리자 중 raw PrismaClientKnownRequestError는 절대 새어 나가지 않는다', async () => {
    const userId = await createTargetUser();
    const actorA = await createAdminActor('a');
    const actorB = await createAdminActor('b');
    const outcomes = await Promise.allSettled([
      new AdminProfileMutationService(
        new AuditLogMetadataService(),
        new UserProfileService(),
        new AdminAccessMutationService(
          new AuditLogMetadataService(),
          new UserProfileService(),
        ),
      ).mutateAdminUserProfile(
        { repository, auditLog },
        {
          actorGithubId: actorA.githubId,
          userId,
          command: { name: '이름 A' },
        },
      ),
      new AdminProfileMutationService(
        new AuditLogMetadataService(),
        new UserProfileService(),
        new AdminAccessMutationService(
          new AuditLogMetadataService(),
          new UserProfileService(),
        ),
      ).mutateAdminUserProfile(
        { repository, auditLog },
        {
          actorGithubId: actorB.githubId,
          userId,
          command: { department: '학과 B' },
        },
      ),
    ]);
    const rejections = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    );
    for (const rejection of rejections) {
      expect(rejection.reason).not.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      expect(rejection.reason).toBeInstanceOf(DomainException);
      expect(rejection.reason).toMatchObject({
        errorCode: USERS_ERROR_CODES[UsersErrorCode.PROFILE_UPDATE_CONFLICT],
      });
    }
    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled',
    );
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const auditRows = await userAuditRows(prisma, {
      action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
      targetId: userId,
    });
    expect(auditRows).toHaveLength(fulfilled.length);
    const persisted = await prisma.user.findUniqueOrThrow({
      include: { admin: true },
      where: { id: userId },
    });
    if (fulfilled.length === 2) {
      expect(persisted.name).toBe('이름 A');
      expect(persisted.department).toBe('학과 B');
    } else {
      const succeededField =
        persisted.name === '이름 A' ? 'name' : 'department';
      expect(['name', 'department']).toContain(succeededField);
    }
  });
});
