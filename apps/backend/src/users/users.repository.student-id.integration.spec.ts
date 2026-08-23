import { MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { UsersRepository } from './users.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const userId = 'test:users:profile';
const githubId = 9_600_000_000_153_001n;
/** 학번 유일성이 계정 경계를 넘는지 보려면 두 번째 계정이 필요하다. */
const otherUserId = 'test:users:profile:other';
const otherGithubId = 9_600_000_000_153_002n;
type StoredProfileFields = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

const prisma = new PrismaService();
const repository = new UsersRepository(prisma);

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  });
  await prisma.user.create({
    data: {
      id: userId,
      githubId,
      nickname: 'synthetic-profile-user',
      name: 'GitHub 합성 이름',
      selectedRole: 'STUDENT',
      selectedMemberKind: MemberKind.STUDENT,
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  });
  await prisma.$disconnect();
});

describe('학번 최초 저장의 유일성', () => {
  const staffProfile = {
    name: '합성 조교',
    department: '인공지능학부',
  };
  const graduateStudentId = '9'.repeat(6);

  /** 학번 없이 완료된 교직원 — UserProfile 행이 아직 없는 상태다. */
  async function makeLegacyOnlyStaff(
    id: string,
    github: bigint,
    nickname: string,
  ): Promise<void> {
    await prisma.user.upsert({
      where: { id },
      update: { role: 'STAFF', ...staffProfile, studentId: null },
      create: {
        id,
        githubId: github,
        nickname,
        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        ...staffProfile,
      },
    });
  }

  async function currentProfile(github: bigint) {
    const current = await repository.findByGithubId(github);
    if (!current) {
      throw new Error('합성 프로필 사용자가 존재해야 합니다.');
    }
    return current;
  }

  beforeEach(async () => {
    await makeLegacyOnlyStaff(userId, githubId, 'synthetic-profile-user');
  });

  it('UserProfile 행이 없던 교직원의 첫 학번도 제약이 걸린 행으로 저장된다', async () => {
    // Given — 예전에는 UserProfile을 0행 갱신하고 제약 없는 User 컬럼에만 남겼다
    const current = await currentProfile(githubId);

    // When
    const outcome = await repository.fillStudentId(current, {
      ...staffProfile,
      studentId: graduateStudentId,
    });

    // Then
    expect(outcome).toBe('filled');
    const profileRows = await prisma.$queryRaw<StoredProfileFields[]>`
      SELECT "name", "studentId", "department"
      FROM "UserProfile"
      WHERE "userId" = ${userId}
    `;
    expect(profileRows).toEqual([
      { ...staffProfile, studentId: graduateStudentId },
    ]);
    await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
      studentId: graduateStudentId,
    });
  });

  it('다른 계정이 이미 쓰는 학번은 두 번째 계정에 저장되지 않는다', async () => {
    // Given — 구버전 User.studentId에는 unique 제약이 없어 예전에는 둘 다 통과했다
    await makeLegacyOnlyStaff(
      otherUserId,
      otherGithubId,
      'synthetic-profile-other',
    );
    const first = await currentProfile(githubId);
    await expect(
      repository.fillStudentId(first, {
        ...staffProfile,
        studentId: graduateStudentId,
      }),
    ).resolves.toBe('filled');

    // When
    const second = await currentProfile(otherGithubId);
    const outcome = await repository.fillStudentId(second, {
      ...staffProfile,
      studentId: graduateStudentId,
    });

    // Then
    expect(outcome).toBe('taken');
    await expect(
      repository.findByGithubId(otherGithubId),
    ).resolves.toMatchObject({ studentId: null });
  });

  it('같은 계정의 동시 최초 저장은 한 건만 성공한다', async () => {
    // Given — 두 요청 모두 학번이 비어 있는 같은 상태를 읽는다
    const current = await currentProfile(githubId);
    const fill = (studentId: string) =>
      repository.fillStudentId(current, { ...staffProfile, studentId });

    // When
    const outcomes = await Promise.all([
      fill(graduateStudentId),
      fill('8'.repeat(6)),
    ]);

    // Then — 예전에는 둘 다 성공해 나중 값이 앞 값을 조용히 덮었다
    expect(outcomes.filter((outcome) => outcome === 'filled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome !== 'filled')).toHaveLength(1);
    const profileRows = await prisma.$queryRaw<StoredProfileFields[]>`
      SELECT "studentId" FROM "UserProfile" WHERE "userId" = ${userId}
    `;
    expect(profileRows).toHaveLength(1);
  });
});

/**
 * 회수된 사용자가 프로필을 마치면 그 저장이 곧 교직원 재신청이다 (#184).
 *
 * ## 이 상태가 어떻게 생기나
 *
 * 보통 회수된 교직원은 프로필이 **이미 완료**라 `patchMyProfile`이 완료 저장 갈래로
 * 내려가지 않는다. 예외가 하나 있다: 관리자가 요청 없이 직접 STAFF를 부여하는 전이는
 * 완료된 프로필을 요구하지 않으므로(`admin-access-transition-table.ts`의
 * `requiresCompleteProfile`는 요청 승인 전이에만 붙는다), 학과를 비워 둔 채 STAFF가
 * 된 사람이 존재할 수 있다. 그가 회수되면 `role: null` + `selectedRole: STAFF` +
 * **미완료**가 된다.
 *
 * ## 그래서 무슨 일이 생기나 — 그리고 왜 그대로 두는가
 *
 * 그가 학과를 채워 저장하면 `completeProfileIfUnchanged` 안의 `confirmSelectedRole`이
 * 새 `PENDING` 요청을 만든다. 막지 않는다.
 *
 * - **그것이 `가입 마치기`의 정의다.** 미완료 → 완료 저장은 고른 역할을 확정하는
 *   순간이고(#569, `users.service.ts`), 교직원의 확정은 곧 승인 요청이다. 그가 고른
 *   역할은 본인이 STAFF로 골라 둔 것이고 화면도 교직원 기준으로 물었다.
 * - **권한이 돌아오지는 않는다.** 만들어지는 것은 `PENDING` 한 건이고 STAFF를 붙이는
 *   것은 관리자의 승인이다 — #184가 재신청을 허용하기로 한 그 판단과 같은 결과다.
 * - **막으면 막다른 길이 된다.** 신청을 만들지 않으면 그의 프로필은 완료가 되는데 확정은
 *   오지 않고, 프로필 화면은 그 뒤로 "이미 완료"라며 그를 내보낸다. 회수 화면이
 *   역할 선택으로 보내도 `selectRole`은 완료된 프로필을 보고 같은 신청을 만든다 —
 *   결국 같은 자리로 돌아온다.
 *
 * 이 검사는 그 동작을 승인하는 것이 아니라 **말하지 않던 사실을 말하게 하는 것**이다.
 * 되돌려 막고 싶어지면 여기가 먼저 빨간불이 된다.
 */
