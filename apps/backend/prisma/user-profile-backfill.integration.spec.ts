import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { Role } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  backfillUserProfiles,
  classifyLegacyProfile,
  USER_PROFILE_BACKFILL_ERROR_KIND,
} from './user-profile-backfill';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const userIds = [
  'test:profile-backfill:complete',
  'test:profile-backfill:all-null',
  'test:profile-backfill:name-only',
  'test:profile-backfill:invalid',
  'test:profile-backfill:duplicate-a',
  'test:profile-backfill:duplicate-b',
  'test:profile-backfill:invalid-complete',
  'test:profile-backfill:staff-without-student-id',
  'test:profile-backfill:student-without-student-id',
] as const;
const completeStudentId = ['96', '0011'].join('');
const duplicateStudentId = ['96', '0012'].join('');
const prisma = new PrismaService();
let existingProfileUserIds: readonly string[] = [];

type LegacyProfileInput = {
  readonly id: (typeof userIds)[number];
  readonly githubId: bigint;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly role?: Role | null;
};

async function createLegacyUser(input: LegacyProfileInput): Promise<void> {
  await prisma.user.create({
    data: {
      ...input,
      nickname: input.id.replaceAll(':', '-'),
    },
  });
}

async function cleanup(): Promise<void> {
  await prisma.userProfile.deleteMany({
    where: { userId: { notIn: [...existingProfileUserIds] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
}

beforeAll(async () => {
  await prisma.$connect();
  existingProfileUserIds = (
    await prisma.userProfile.findMany({ select: { userId: true } })
  ).map(({ userId }) => userId);
});

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

it('완료 행만 한 번 backfill하고 전체-null·이름-only 행은 건너뛴다', async () => {
  // Given
  const existingCandidateCount = (
    await prisma.user.findMany({
      where: {
        id: { notIn: [...userIds] },
        profile: { is: null },
      },
      select: { name: true, studentId: true, department: true },
    })
  ).filter((user) => classifyLegacyProfile(user).kind === 'COMPLETE').length;
  await Promise.all([
    createLegacyUser({
      id: userIds[0],
      githubId: 9_600_000_000_153_201n,
      name: '합성 완료 사용자',
      studentId: completeStudentId,
      department: '인공지능학부',
    }),
    createLegacyUser({
      id: userIds[1],
      githubId: 9_600_000_000_153_202n,
      name: null,
      studentId: null,
      department: null,
    }),
    createLegacyUser({
      id: userIds[2],
      githubId: 9_600_000_000_153_203n,
      name: 'Legacy GitHub Name',
      studentId: null,
      department: null,
    }),
  ]);

  // When
  const firstCreated = await backfillUserProfiles(prisma);
  const secondCreated = await backfillUserProfiles(prisma);

  // Then
  expect(firstCreated).toBe(existingCandidateCount + 1);
  expect(secondCreated).toBe(0);
  await expect(
    prisma.userProfile.findMany({
      where: { userId: { in: [...userIds] } },
      select: {
        userId: true,
        name: true,
        studentId: true,
        department: true,
      },
    }),
  ).resolves.toEqual([
    {
      userId: userIds[0],
      name: '합성 완료 사용자',
      studentId: completeStudentId,
      department: '인공지능학부',
    },
  ]);
});

it.each([
  ['ADMIN', { role: Role.ADMIN }, 'LEGACY_ONLY_COMPLETE'],
  ['선택한 STAFF', { selectedRole: Role.STAFF }, 'LEGACY_ONLY_COMPLETE'],
  ['대기 중 STAFF', { hasPendingStaffRequest: true }, 'LEGACY_ONLY_COMPLETE'],
  ['역할 근거 없음', {}, 'IMPOSSIBLE_PARTIAL'],
] as const)(
  '학번 없는 %s 프로필을 역할 근거에 맞게 분류한다',
  (_label, roleEvidence, expectedKind) => {
    expect(
      classifyLegacyProfile({
        name: '합성 역할별 사용자',
        studentId: null,
        department: '소프트웨어공학과',
        ...roleEvidence,
      }),
    ).toEqual({ kind: expectedKind });
  },
);

it('학번 없는 STAFF는 남기되 같은 필드의 STUDENT는 거부한다', async () => {
  // Given — 제품의 정상 프로필 완료 경로가 만드는 STAFF legacy-only 상태.
  await createLegacyUser({
    id: userIds[7],
    githubId: 9_600_000_000_153_208n,
    name: '합성 학번 없는 교직원',
    studentId: null,
    department: '소프트웨어공학과',
    role: Role.STAFF,
  });

  // When
  const created = await backfillUserProfiles(prisma);

  // Then — UserProfile의 필수·unique studentId를 완화하거나 가짜 값으로 채우지 않는다.
  expect(created).toBe(0);
  await expect(
    prisma.user.findUniqueOrThrow({ where: { id: userIds[7] } }),
  ).resolves.toMatchObject({
    name: '합성 학번 없는 교직원',
    studentId: null,
    department: '소프트웨어공학과',
    role: Role.STAFF,
  });
  await expect(
    prisma.userProfile.count({ where: { userId: userIds[7] } }),
  ).resolves.toBe(0);

  await createLegacyUser({
    id: userIds[8],
    githubId: 9_600_000_000_153_209n,
    name: '합성 학번 없는 학생',
    studentId: null,
    department: '소프트웨어공학과',
    role: Role.STUDENT,
  });

  await expect(backfillUserProfiles(prisma)).rejects.toMatchObject({
    kind: USER_PROFILE_BACKFILL_ERROR_KIND.IMPOSSIBLE_PARTIAL,
    userIds: [userIds[8]],
  });
  await expect(
    prisma.userProfile.count({ where: { userId: userIds[8] } }),
  ).resolves.toBe(0);
});

it('불가능한 부분 프로필은 legacy 행을 바꾸지 않고 backfill 전체를 중단한다', async () => {
  // Given
  await createLegacyUser({
    id: userIds[3],
    githubId: 9_600_000_000_153_204n,
    name: null,
    studentId: completeStudentId,
    department: '인공지능학부',
  });
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: userIds[3] },
  });

  // When
  const backfill = backfillUserProfiles(prisma);

  // Then
  await expect(backfill).rejects.toMatchObject({
    kind: USER_PROFILE_BACKFILL_ERROR_KIND.IMPOSSIBLE_PARTIAL,
    userIds: [userIds[3]],
  });
  await expect(
    prisma.user.findUniqueOrThrow({ where: { id: userIds[3] } }),
  ).resolves.toEqual(before);
  await expect(
    prisma.userProfile.count({ where: { userId: userIds[3] } }),
  ).resolves.toBe(0);
});

it('필드는 모두 있지만 정책에 맞지 않는 프로필은 어떤 프로필도 만들기 전에 중단한다', async () => {
  // Given
  await createLegacyUser({
    id: userIds[6],
    githubId: 9_600_000_000_153_207n,
    name: '합성 정책 위반 사용자',
    studentId: 'invalid-id',
    department: '인공지능학부',
  });

  // When
  const backfill = backfillUserProfiles(prisma);

  // Then
  await expect(backfill).rejects.toMatchObject({
    kind: USER_PROFILE_BACKFILL_ERROR_KIND.INVALID_COMPLETE,
    userIds: [userIds[6]],
  });
  await expect(
    prisma.userProfile.count({ where: { userId: userIds[6] } }),
  ).resolves.toBe(0);
});

it('중복 학번은 legacy 행을 바꾸지 않고 어떤 프로필도 만들기 전에 중단한다', async () => {
  // Given
  await Promise.all([
    createLegacyUser({
      id: userIds[4],
      githubId: 9_600_000_000_153_205n,
      name: '합성 중복 사용자 A',
      studentId: duplicateStudentId,
      department: '인공지능학부',
    }),
    createLegacyUser({
      id: userIds[5],
      githubId: 9_600_000_000_153_206n,
      name: '합성 중복 사용자 B',
      studentId: duplicateStudentId,
      department: '소프트웨어공학과',
    }),
  ]);
  const before = await prisma.user.findMany({
    where: { id: { in: [userIds[4], userIds[5]] } },
    orderBy: { id: 'asc' },
  });

  // When
  const backfill = backfillUserProfiles(prisma);

  // Then
  await expect(backfill).rejects.toMatchObject({
    kind: USER_PROFILE_BACKFILL_ERROR_KIND.DUPLICATE_STUDENT_ID,
    userIds: [userIds[4], userIds[5]],
  });
  await expect(
    prisma.user.findMany({
      where: { id: { in: [userIds[4], userIds[5]] } },
      orderBy: { id: 'asc' },
    }),
  ).resolves.toEqual(before);
  await expect(
    prisma.userProfile.count({
      where: { userId: { in: [userIds[4], userIds[5]] } },
    }),
  ).resolves.toBe(0);
});
