import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  backfillUserProfiles,
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
] as const;
const completeStudentId = ['96', '00153101'].join('');
const duplicateStudentId = ['96', '00153102'].join('');
const prisma = new PrismaService();

type LegacyProfileInput = {
  readonly id: (typeof userIds)[number];
  readonly githubId: bigint;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
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
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

it('완료 행만 한 번 backfill하고 전체-null·이름-only 행은 건너뛴다', async () => {
  // Given
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
  expect(firstCreated).toBe(1);
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
