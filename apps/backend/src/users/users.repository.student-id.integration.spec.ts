import { AffiliationKind, MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalCompletion } from './member-authority-test-fixtures';
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
const studentProfile = {
  name: '합성 학생',
  studentId: '9'.repeat(6),
  department: '인공지능학부',
};
type StoredProfileFields = {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly memberKind: MemberKind;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
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
      selectedMemberKind: MemberKind.STUDENT,
      hasStaffAccess: false,
      hasAdminAccess: false,
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
  async function createOnboardingStudent(
    id: string,
    github: bigint,
    nickname: string,
  ): Promise<void> {
    await prisma.user.upsert({
      where: { id },
      update: {
        selectedMemberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
      create: {
        id,
        githubId: github,
        nickname,
        selectedMemberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
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

  it('학생의 첫 학번은 유일 제약이 걸린 UserProfile 행으로 저장된다', async () => {
    // Given
    const current = await currentProfile(githubId);

    // When
    const outcome = await repository.completeProfileIfUnchanged(
      current,
      canonicalCompletion(studentProfile),
    );

    // Then
    expect(outcome).toBe('completed');
    const profileRows = await prisma.$queryRaw<StoredProfileFields[]>`
      SELECT "name", "studentId", "department",
             "memberKind", "affiliationKind", "affiliationName"
      FROM "UserProfile"
      WHERE "userId" = ${userId}
    `;
    expect(profileRows).toEqual([
      {
        ...studentProfile,
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: studentProfile.department,
      },
    ]);
    await expect(repository.findByGithubId(githubId)).resolves.toMatchObject({
      studentId: studentProfile.studentId,
      memberKind: MemberKind.STUDENT,
    });
  });

  it('다른 계정이 이미 쓰는 학번은 두 번째 계정에 저장되지 않는다', async () => {
    // Given
    await createOnboardingStudent(
      otherUserId,
      otherGithubId,
      'synthetic-profile-other',
    );
    const first = await currentProfile(githubId);
    await expect(
      repository.completeProfileIfUnchanged(
        first,
        canonicalCompletion(studentProfile),
      ),
    ).resolves.toBe('completed');

    // When
    const second = await currentProfile(otherGithubId);
    const outcome = await repository.completeProfileIfUnchanged(
      second,
      canonicalCompletion({
        ...studentProfile,
        name: '합성 둘째 학생',
      }),
    );

    // Then
    expect(outcome).toBe('student-id-taken');
    await expect(
      prisma.userProfile.findUnique({ where: { userId: otherUserId } }),
    ).resolves.toBeNull();
    await expect(
      repository.findByGithubId(otherGithubId),
    ).resolves.toMatchObject({
      studentId: null,
      memberKind: null,
    });
  });

  it('같은 학번을 두 계정이 동시에 저장하면 한 건만 성공한다', async () => {
    // Given
    await createOnboardingStudent(
      otherUserId,
      otherGithubId,
      'synthetic-profile-other',
    );
    const first = await currentProfile(githubId);
    const second = await currentProfile(otherGithubId);
    const complete = (current: typeof first, name: string) =>
      repository.completeProfileIfUnchanged(
        current,
        canonicalCompletion({ ...studentProfile, name }),
      );

    // When
    const outcomes = await Promise.all([
      complete(first, '합성 동시 첫째'),
      complete(second, '합성 동시 둘째'),
    ]);

    // Then — unique 제약이 두 번째 쓰기를 거절한다
    expect(outcomes.filter((outcome) => outcome === 'completed')).toHaveLength(
      1,
    );
    expect(
      outcomes.filter((outcome) => outcome === 'student-id-taken'),
    ).toHaveLength(1);
    const profileRows = await prisma.$queryRaw<{ studentId: string }[]>`
      SELECT "studentId" FROM "UserProfile"
      WHERE "studentId" = ${studentProfile.studentId}
    `;
    expect(profileRows).toEqual([{ studentId: studentProfile.studentId }]);
  });
});

/**
 * 회수된 사용자가 프로필을 마치면 그 저장이 곧 교직원 재신청이다 (#184).
 *
 * ## 이 상태가 어떻게 생기나
 *
 * 보통 회수된 교직원은 프로필이 **이미 완료**라 `patchMyProfile`이 완료 저장 갈래로
 * 내려가지 않는다. 예외가 하나 있다: 관리자가 요청 없이 직접 교직원 접근을 켜는
 * 전이는 완료된 프로필을 요구하지 않으므로(`admin-access-transition-table.ts`의
 * `requiresCompleteProfile`는 요청 승인 전이에만 붙는다), 프로필 행 없이
 * `hasStaffAccess`만 켜진 사람이 존재할 수 있다. 그가 회수되면
 * `hasStaffAccess: false` + `selectedMemberKind: STAFF` + **미완료**가 된다.
 *
 * ## 그래서 무슨 일이 생기나 — 그리고 왜 그대로 두는가
 *
 * 그가 소속을 채워 저장하면 `completeProfileIfUnchanged` 안의 `requestStaffAccess`이
 * 새 `PENDING` 요청을 만든다. 막지 않는다.
 *
 * - **그것이 `가입 마치기`의 정의다.** 미완료 → 완료 저장은 고른 유형을 확정하는
 *   순간이고(#569, `users.service.ts`), 교직원의 확정은 곧 승인 요청이다. 그가 고른
 *   유형은 본인이 STAFF로 골라 둔 것이고 화면도 교직원 기준으로 물었다.
 * - **권한이 돌아오지는 않는다.** 만들어지는 것은 `PENDING` 한 건이고 교직원 접근을
 *   켜는 것은 관리자의 승인이다 — #184가 재신청을 허용하기로 한 그 판단과 같은
 *   결과다.
 * - **막으면 막다른 길이 된다.** 신청을 만들지 않으면 그의 프로필은 완료가 되는데
 *   확정은 오지 않고, 프로필 화면은 그 뒤로 "이미 완료"라며 그를 내보낸다. 회수
 *   화면이 유형 선택으로 보내도 `selectMemberKind`는 완료된 프로필을 보고 같은
 *   신청을 만든다 — 결국 같은 자리로 돌아온다.
 *
 * 이 검사는 그 동작을 승인하는 것이 아니라 **말하지 않던 사실을 말하게 하는 것**이다.
 * 되돌려 막고 싶어지면 여기가 먼저 빨간불이 된다.
 */
