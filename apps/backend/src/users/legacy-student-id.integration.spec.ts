import { Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { UsersErrorCode } from './users-error-code.enum';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

/**
 * 학번 형식이 강화되기(#835) 전에 가입한 학생.
 *
 * 그때는 6~10자리를 받았고, 마이그레이션 없이 규칙만 바뀌어 예전 값이 그대로 남았다.
 * 실재하는 학번이 아니라 자릿수만 맞춘 합성값이다.
 */
const LEGACY_STUDENT_ID = '9'.repeat(9);
const NEW_STUDENT_ID = '1'.repeat(6);
const userId = 'test:users:legacy-student-id';
const githubId = 9_600_000_000_153_101n;
const name = '합성 재학생';
const department = '인공지능학부';

type StoredProfileFields = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

const prisma = new PrismaService();
// 동의 확인은 이 시나리오의 관심사가 아니다 — 저장소는 진짜를 쓴다.
const service = new UsersService(new UsersRepository(prisma), {
  requireCurrent: () => Promise.resolve(),
});

function readLegacyColumns(): Promise<StoredProfileFields[]> {
  return prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "department"
    FROM "User"
    WHERE "id" = ${userId}
  `;
}

function readProfileRow(): Promise<StoredProfileFields[]> {
  return prisma.$queryRaw<StoredProfileFields[]>`
    SELECT "name", "studentId", "department"
    FROM "UserProfile"
    WHERE "userId" = ${userId}
  `;
}

async function captureDomainException(
  operation: () => Promise<unknown>,
): Promise<DomainException> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof DomainException) {
      return error;
    }
    throw error;
  }
  throw new Error('DomainException이 발생해야 합니다.');
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  // 예전 형식으로 이미 가입을 마친 학생 — UserProfile 행까지 만들어져 있다.
  await prisma.user.create({
    data: {
      id: userId,
      githubId,
      nickname: 'synthetic-legacy-student',
      name,
      studentId: LEGACY_STUDENT_ID,
      department,
      role: Role.STUDENT,
      profile: { create: { name, studentId: LEGACY_STUDENT_ID, department } },
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

/**
 * 완료 판정이 뒤집히면 게이트가 이 사람을 온보딩으로 되돌린다.
 *
 * 세션의 `isProfileComplete`도, 프로필 응답의 `isComplete`도 같은 정책 함수에서
 * 나온다(`auth.repository.ts`, `toUserProfile`). 여기가 false가 되는 순간 학생은
 * 가입 마지막 단계에 갇히고, 학번은 바꿀 수 없는 값이라 빠져나갈 방법이 없다.
 */
it('예전 형식 학번으로 가입을 마친 학생은 완료된 프로필로 읽힌다', async () => {
  await expect(service.getMyProfile(githubId)).resolves.toEqual({
    name,
    studentId: LEGACY_STUDENT_ID,
    department,
    isComplete: true,
  });
});

/** 온보딩 화면이 저장된 학번을 빼고 보내는 요청 — 이름·학과만 갱신된다. */
it('학번을 싣지 않은 저장은 예전 형식 학번을 건드리지 않고 통과한다', async () => {
  await expect(
    service.patchMyProfile(githubId, {
      name: '합성 재학생2',
      department: '소프트웨어공학과',
    }),
  ).resolves.toMatchObject({
    studentId: LEGACY_STUDENT_ID,
    isComplete: true,
  });

  const stored = {
    name: '합성 재학생2',
    studentId: LEGACY_STUDENT_ID,
    department: '소프트웨어공학과',
  };
  await expect(readLegacyColumns()).resolves.toEqual([stored]);
  await expect(readProfileRow()).resolves.toEqual([stored]);
});

/**
 * 신고된 두 번째 증상의 자리 — 6자리로 고쳐 다시 눌러도 같은 벽에 부딪힌다.
 *
 * 완료 판정이 false가 되면 이 요청은 "최초 완료 저장" 경로로 흘러 UserProfile 행을
 * **새로 만들려다** 기본키 충돌(P2002)로 실패하고, 서비스는 그것을 `USR_001`(이미
 * 완료됨)로 옮긴다. 화면은 그 코드를 보고 다음 화면으로 보내지만 게이트가 여전히
 * 미완료로 판정해 곧바로 되돌려보낸다. 저장은 한 글자도 되지 않았으므로 되돌아온
 * 화면에는 다시 옛 9자리 값과 같은 오류가 뜬다 — 신고된 그대로다.
 *
 * 학번은 학적 식별자로 고정된 값이라 답은 `USR_003`이다. 데이터는 어느 쪽도 바뀌지
 * 않아야 한다 — 반쪽만 쓰이면 두 저장 자리가 서로 다른 학번을 들고 갈라진다.
 */
it('학번을 6자리로 바꾸려는 저장은 거절하고 데이터를 그대로 둔다', async () => {
  const exception = await captureDomainException(() =>
    service.patchMyProfile(githubId, {
      name,
      studentId: NEW_STUDENT_ID,
      department,
    }),
  );

  expect(exception.errorCode.code).toBe(UsersErrorCode.STUDENT_ID_IMMUTABLE);

  const stored = { name, studentId: LEGACY_STUDENT_ID, department };
  await expect(readLegacyColumns()).resolves.toEqual([stored]);
  await expect(readProfileRow()).resolves.toEqual([stored]);
});

/**
 * 운영 DB 실측이 알려 온 계정 모양 — `User.studentId`는 비어 있는데 `UserProfile`
 * 행에는 예전 형식 학번이 들어 있다.
 *
 * 화면이 보는 값은 `UserProfile` 행이다(`resolveUserProfile`이 그 행을 먼저
 * 본다). 그래서 legacy 컬럼만 조회하면 학번이 없어 보이지만, 프로필 응답에는 9자리
 * 값이 실려 화면의 학번 칸이 그 값으로 채워진다 — QA가 본 그대로다.
 *
 * 이 모양에서는 완료 저장 경로가 한 겹 더 막힌다. CAS의 기준값은 `UserProfile` 행에서
 * 온 값인데 비교 대상은 legacy 컬럼이라 어느 값을 보내든 0행이 갱신되고, 서비스는 그
 * 실패를 `USR_001`(이미 완료됨)로 옮긴다. 화면은 그 코드를 다음 화면으로 읽고 게이트가
 * 곧바로 되돌려보내, 학번 칸에는 다시 옛 9자리 값이 뜬다.
 *
 * 완료로 읽히면 이 사람은 애초에 온보딩에 들어가지 않으므로 그 경로를 밟지 않는다.
 */
describe('legacy 컬럼만 비어 있는 계정', () => {
  const DESYNCED_STUDENT_ID = '8'.repeat(9);

  beforeEach(async () => {
    await prisma.user.update({
      where: { id: userId },
      data: {
        studentId: null,
        profile: { update: { studentId: DESYNCED_STUDENT_ID } },
      },
    });
  });

  it('UserProfile 행의 예전 형식 학번을 완료로 읽는다', async () => {
    await expect(service.getMyProfile(githubId)).resolves.toEqual({
      name,
      studentId: DESYNCED_STUDENT_ID,
      department,
      isComplete: true,
    });
  });

  it('이름·학과 저장이 통과하고 학번은 그대로 남는다', async () => {
    await expect(
      service.patchMyProfile(githubId, { name: '합성 재학생3', department }),
    ).resolves.toMatchObject({
      studentId: DESYNCED_STUDENT_ID,
      isComplete: true,
    });

    await expect(readProfileRow()).resolves.toEqual([
      { name: '합성 재학생3', studentId: DESYNCED_STUDENT_ID, department },
    ]);
  });
});

/**
 * 학번이 어디에도 없는 학생 — `UserProfile` 행도 없다.
 *
 * 이 사람은 형식 규칙과 무관하게 처음부터 미완료이므로 온보딩에서 학번을 새로 받아야
 * 하고, 그 경로는 이 변경 전후로 똑같이 열려 있어야 한다. 저장된 값의 예외가 새 값의
 * 6자리 규칙까지 열어 버리지 않았는지도 여기서 함께 본다.
 */
describe('학번이 아무 데도 없는 학생', () => {
  const NEW_ONBOARDING_STUDENT_ID = '2'.repeat(6);

  beforeEach(async () => {
    await prisma.userProfile.deleteMany({ where: { userId } });
    await prisma.user.update({
      where: { id: userId },
      data: { studentId: null, department: null },
    });
  });

  it('미완료로 읽히고 새 6자리 학번으로 가입을 마친다', async () => {
    await expect(service.getMyProfile(githubId)).resolves.toMatchObject({
      studentId: null,
      isComplete: false,
    });

    await expect(
      service.completeMyProfile(githubId, {
        name,
        studentId: NEW_ONBOARDING_STUDENT_ID,
        department,
      }),
    ).resolves.toMatchObject({
      studentId: NEW_ONBOARDING_STUDENT_ID,
      isComplete: true,
    });

    const stored = { name, studentId: NEW_ONBOARDING_STUDENT_ID, department };
    await expect(readLegacyColumns()).resolves.toEqual([stored]);
    await expect(readProfileRow()).resolves.toEqual([stored]);
  });

  it('형식이 틀린 새 학번은 400으로 거부한다', async () => {
    const exception = await captureDomainException(() =>
      service.completeMyProfile(githubId, {
        name,
        studentId: LEGACY_STUDENT_ID,
        department,
      }),
    );

    expect(exception.errorCode.status).toBe(400);
    await expect(readProfileRow()).resolves.toEqual([]);
  });
});
