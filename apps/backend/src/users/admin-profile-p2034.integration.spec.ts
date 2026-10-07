import { AffiliationKind, MemberKind, Prisma } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { USER_PROFILE_AUDIT_ACTIONS } from '../audit-log/audit-log-metadata';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { AdminProfileRepository } from './admin-profile.repository';
import { mutateAdminUserProfile } from './admin-profile-mutation.service';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'test:qa58:admin-profile-p2034:';
const TARGET_PREFIX = `${TEST_PREFIX}target:`;
const GITHUB_ID_BASE = 9_058_000_000n;

const prisma = new PrismaService();
const repository = new AdminProfileRepository(prisma);
const auditLog = new AuditLogService(new AuditLogRepository(prisma));

let sequence = 0;

async function cleanup(): Promise<void> {
  await prisma.userProfile.deleteMany({
    where: { userId: { startsWith: TARGET_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { id: { startsWith: TARGET_PREFIX } },
  });
}

async function createTargetUser(): Promise<string> {
  sequence += 1;
  const id = `${TARGET_PREFIX}${sequence}`;
  await prisma.user.create({
    data: {
      id,
      githubId: GITHUB_ID_BASE + BigInt(sequence),
      nickname: `synthetic-qa58-target-${sequence}`,
      profile: {
        create: {
          name: '합성 초기 이름',
          studentId: `${920_000 + sequence}`,
          department: '합성 학과',
          memberKind: MemberKind.STUDENT,
          affiliationKind: AffiliationKind.DEPARTMENT,
          affiliationName: '합성 학과',
        },
      },
    },
  });
  return id;
}

async function createAdminActor(
  label: string,
): Promise<{ readonly githubId: bigint; readonly name: string }> {
  sequence += 1;
  const name = `관리자 ${label}`;
  const created = await prisma.user.create({
    data: {
      id: `${TEST_PREFIX}actor-${label}:${sequence}`,
      githubId: GITHUB_ID_BASE + 100_000n + BigInt(sequence),
      nickname: `synthetic-qa58-actor-${label}-${sequence}`,
      hasAdminAccess: true,
    },
    select: { githubId: true },
  });
  return { githubId: created.githubId, name };
}

describe('AdminProfileRepository P2034 직렬화 충돌 재시도 (QA58)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('서로 다른 필드를 동시에 고치는 두 관리자 중 raw PrismaClientKnownRequestError는 절대 새어 나가지 않는다', async () => {
    const userId = await createTargetUser();
    const actorA = await createAdminActor('a');
    const actorB = await createAdminActor('b');

    const outcomes = await Promise.allSettled([
      mutateAdminUserProfile(
        { repository, auditLog },
        {
          actorGithubId: actorA.githubId,
          userId,
          command: { name: '이름 A' },
        },
      ),
      mutateAdminUserProfile(
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

    const auditRows = await prisma.auditLog.findMany({
      where: {
        action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
        targetId: userId,
      },
    });
    expect(auditRows).toHaveLength(fulfilled.length);

    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true },
    });
    if (fulfilled.length === 2) {
      expect(persisted.profile?.name).toBe('이름 A');
      expect(persisted.profile?.department).toBe('학과 B');
    } else {
      const succeededField =
        persisted.profile?.name === '이름 A' ? 'name' : 'department';
      expect(['name', 'department']).toContain(succeededField);
    }
  });
});
