import { AffiliationKind, MemberKind, Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsersRepository } from '../src/users/users.repository';
import { UsersService } from '../src/users/users.service';
import {
  backfillUserProfiles,
  USER_PROFILE_BACKFILL_ERROR_KIND,
} from './user-profile-backfill';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const TEST_PREFIX = 'test:profile-backfill:canonical-task8:';
const studentId = `${TEST_PREFIX}student`;
const staffId = `${TEST_PREFIX}staff`;
const malformedId = `${TEST_PREFIX}malformed`;
const prisma = new PrismaService();
const users = new UsersService(new UsersRepository(prisma), {
  requireCurrent: () => Promise.resolve(undefined),
});

async function createOnboardingUser(
  id: string,
  githubId: bigint,
  memberKind: MemberKind,
): Promise<void> {
  await prisma.user.create({
    data: {
      id,
      githubId,
      nickname: id.replaceAll(':', '-'),
      selectedRole:
        memberKind === MemberKind.STUDENT ? Role.STUDENT : Role.STAFF,
      selectedMemberKind: memberKind,
    },
  });
}

async function cleanup(): Promise<void> {
  await prisma.roleRequest.deleteMany({
    where: { userId: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

it('is idempotent after canonical Task 8 STUDENT and STAFF completion', async () => {
  // Given
  await createOnboardingUser(
    studentId,
    9_600_000_000_158_101n,
    MemberKind.STUDENT,
  );
  await createOnboardingUser(staffId, 9_600_000_000_158_102n, MemberKind.STAFF);
  await users.completeMyProfile(9_600_000_000_158_101n, {
    name: '합성 canonical 학생',
    studentId: '965810',
    department: '인공지능학부',
  });
  await users.completeMyProfile(9_600_000_000_158_102n, {
    name: '합성 canonical 교직원',
    affiliationKind: AffiliationKind.PROGRAM_OFFICE,
    affiliationName: '합성 사업단',
  });

  // When
  const firstCreated = await backfillUserProfiles(prisma, {
    userIdPrefix: TEST_PREFIX,
  });
  const secondCreated = await backfillUserProfiles(prisma, {
    userIdPrefix: TEST_PREFIX,
  });

  // Then
  expect([firstCreated, secondCreated]).toEqual([0, 0]);
  await expect(
    prisma.userProfile.findMany({
      where: { userId: { in: [studentId, staffId] } },
      orderBy: { userId: 'asc' },
      select: { userId: true, memberKind: true, studentId: true },
    }),
  ).resolves.toEqual([
    { userId: staffId, memberKind: MemberKind.STAFF, studentId: null },
    { userId: studentId, memberKind: MemberKind.STUDENT, studentId: '965810' },
  ]);
});

it('still fails closed for a mismatched legacy-only canonical-shaped row', async () => {
  // Given
  await prisma.user.create({
    data: {
      id: malformedId,
      githubId: 9_600_000_000_158_103n,
      nickname: malformedId.replaceAll(':', '-'),
      name: '합성 legacy 이름',
      studentId: null,
      department: '합성 사업단',
      selectedRole: Role.STAFF,
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: false,
      hasAdminAccess: false,
      profile: {
        create: {
          name: '불일치 canonical 이름',
          studentId: null,
          department: '합성 사업단',
          memberKind: MemberKind.STAFF,
          affiliationKind: AffiliationKind.PROGRAM_OFFICE,
          affiliationName: '합성 사업단',
        },
      },
    },
  });

  // When
  const backfill = backfillUserProfiles(prisma, {
    userIdPrefix: TEST_PREFIX,
  });

  // Then
  await expect(backfill).rejects.toMatchObject({
    kind: USER_PROFILE_BACKFILL_ERROR_KIND.PROFILE_MISMATCH,
    userIds: [malformedId],
  });
});
