import { Prisma, Role } from '@prisma/client';
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
  // 대상(target) 행만 지운다. 관리자 액터 행은 AuditLog.actorId가 FK로 참조하고
  // AuditLog는 append-only라 삭제가 아예 불가능하다(`audit-log-append-only.integration.spec.ts`)
  // — 지우려 하면 `AuditLog_actorId_fkey` 위반으로 배치 전체가 실패해 target 행까지
  // 남아버린다. target 행은 이름/학과만 채워지고 학번이 비어 있는 "불가능한 부분
  // 프로필" 상태로 남을 수 있어(`prisma/user-profile-backfill.ts`의
  // IMPOSSIBLE_PARTIAL) 다른 스펙의 전역 backfill 불변식 검사를 오염시키므로 반드시
  // 지운다. 액터 행은 EXPECTED_INCOMPLETE 모양이라 남아도 무해하고, 격리된 테스트
  // DB는 스위트 종료 후 컨테이너째 폐기된다.
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
      name: '기존 이름',
      // studentId/department는 비워 UserProfile 행 없이 구버전 컬럼만 갱신하는
      // 경로(applyLegacyFields)를 타게 한다 — 두 관리자가 서로 다른 legacy
      // 컬럼(name/department)을 같은 User 행에서 동시에 고치는 상황을 만든다.
    },
  });
  return id;
}

// 감사 로그는 actorGithubId로 실제 User 행을 connect한다(`audit-log.repository.ts`
// record()`) — 존재하지 않는 githubId를 쓰면 P2025로 실패한다. 관리자 액터도
// 실제 행으로 만들어야 한다.
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
      role: Role.ADMIN,
      name,
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
    // Given
    const userId = await createTargetUser();
    const actorA = await createAdminActor('a');
    const actorB = await createAdminActor('b');

    // When — 이름을 고치는 관리자 A, 학과를 고치는 관리자 B가 같은 User 행을
    // 동시에 건드린다. `RepeatableRead` 아래 둘 다 `user.update`로 같은 행을
    // 쓰므로 한쪽은 Postgres 직렬화 충돌(P2034)을 반드시 겪는다.
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

    // Then — raw Prisma 에러는 절대 밖으로 새지 않는다. 재시도로 흡수돼 둘 다
    // 성공하거나, 재시도를 다 써도 안 되면 409 PROFILE_UPDATE_CONFLICT여야 한다.
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
    // 최소 한쪽은 성공한다 — 둘 다 재시도 소진으로 실패하는 경우는 없다.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // 성공한 요청만큼 감사 로그가 남고, 그 안의 실제 필드 변경 내역도 함께 확인한다.
    const auditRows = await prisma.auditLog.findMany({
      where: {
        action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
        targetId: userId,
      },
    });
    expect(auditRows).toHaveLength(fulfilled.length);

    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (fulfilled.length === 2) {
      expect(persisted.name).toBe('이름 A');
      expect(persisted.department).toBe('학과 B');
    } else {
      // 한쪽만 성공했다면 실패한 쪽의 필드는 원래 값(null)에 머물러야 한다.
      const succeededField =
        persisted.name === '이름 A' ? 'name' : 'department';
      expect(['name', 'department']).toContain(succeededField);
    }
  });
});
