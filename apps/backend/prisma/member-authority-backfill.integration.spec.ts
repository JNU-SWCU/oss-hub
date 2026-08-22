import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemberKind, PrismaClient } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { parseMemberAuthorityFixture } from './member-authority-backfill-fixture';
import {
  backfillMemberAuthority,
  readMemberAuthorityStatus,
} from './member-authority-backfill';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaClient();
const prefix = 'fixture:member-authority:';
const fixturePath = join(__dirname, 'fixtures/member-authority-62-users.json');
const fixture = parseMemberAuthorityFixture(
  JSON.parse(readFileSync(fixturePath, 'utf8')),
);

beforeAll(async () => {
  await prisma.$connect();
  await clearFixture();
  for (const user of fixture.users) {
    await prisma.user.create({
      data: {
        id: user.id,
        githubId: BigInt(user.githubId),
        nickname: user.nickname,
        role: user.role,
        selectedRole: user.selectedRole,
        selectedMemberKind: user.selectedMemberKind,
        hasStaffAccess: user.hasStaffAccess,
        hasAdminAccess: user.hasAdminAccess,
        name: user.name,
        studentId: user.studentId,
        department: user.department,
        ...(user.profile === null ? {} : { profile: { create: user.profile } }),
      },
    });
  }
  await prisma.roleRequest.createMany({
    data: fixture.requests.map((request) => ({
      id: request.id,
      userId: request.userId,
      status: request.status,
      decidedById: request.decidedById,
    })),
  });
});

afterAll(async () => {
  await clearFixture();
  await prisma.$disconnect();
});

it('backfills the exact 62-user and four-request fixture twice without identity or history loss', async () => {
  // Given
  const beforeUsers = await prisma.user.findMany({
    where: { id: { startsWith: prefix } },
    select: { id: true, githubId: true },
    orderBy: { id: 'asc' },
  });
  const beforeRequests = await requestHistory();

  // When
  const pristineStatus = await readMemberAuthorityStatus(prisma, {
    userIdPrefix: prefix,
  });
  const first = await backfillMemberAuthority(prisma, {
    userIdPrefix: prefix,
  });
  const settledStatus = await readMemberAuthorityStatus(prisma, {
    userIdPrefix: prefix,
  });
  const second = await backfillMemberAuthority(prisma, {
    userIdPrefix: prefix,
  });

  // Then
  expect(pristineStatus).toMatchObject({
    version: '20260822-member-authority-v2',
    expected: { changedUsers: 62 },
  });
  expect(first).toMatchObject({
    version: '20260822-member-authority-v2',
    changedUsers: 62,
    changedProfiles: 60,
    createdProfiles: 4,
    clearedNonStudentIds: 8,
    after: {
      users: 62,
      profiles: 60,
      requests: 4,
      legacyRoles: { STUDENT: 52, STAFF: 3, ADMIN: 5, UNASSIGNED: 2 },
      memberKinds: { STUDENT: 52, STAFF: 3, UNRESOLVED_ASSIGNED: 5 },
      selectedMemberKinds: { STUDENT: 54, STAFF: 3, UNRESOLVED: 5 },
      unassignedMemberKinds: { STUDENT: 0, STAFF: 0, UNRESOLVED: 2 },
      requestStatuses: { APPROVED: 4 },
      compatibilityOnlyAdminAuthorities: 5,
    },
  });
  expect(settledStatus).toMatchObject({
    version: '20260822-member-authority-v2',
    expected: { changedUsers: 0, changedProfiles: 0 },
  });
  expect(second).toMatchObject({
    version: '20260822-member-authority-v2',
    changedUsers: 0,
    changedProfiles: 0,
  });
  await expect(
    prisma.user.findMany({
      where: { id: { startsWith: prefix } },
      select: { id: true, githubId: true },
      orderBy: { id: 'asc' },
    }),
  ).resolves.toEqual(beforeUsers);
  await expect(requestHistory()).resolves.toEqual(beforeRequests);
  await expect(
    prisma.user.findMany({
      where: { id: { startsWith: `${prefix}user:unassigned:` } },
      select: {
        selectedRole: true,
        selectedMemberKind: true,
        profile: { select: { memberKind: true } },
      },
      orderBy: { id: 'asc' },
    }),
  ).resolves.toEqual([
    {
      selectedRole: 'STUDENT',
      selectedMemberKind: MemberKind.STUDENT,
      profile: null,
    },
    {
      selectedRole: 'STUDENT',
      selectedMemberKind: MemberKind.STUDENT,
      profile: null,
    },
  ]);
  await expect(
    prisma.userProfile.count({
      where: { memberKind: MemberKind.STUDENT },
    }),
  ).resolves.toBeGreaterThanOrEqual(52);
});

async function requestHistory() {
  return prisma.roleRequest.findMany({
    where: { userId: { startsWith: prefix } },
    select: { id: true, userId: true, status: true, decidedById: true },
    orderBy: { id: 'asc' },
  });
}

async function clearFixture(): Promise<void> {
  await prisma.roleRequest.deleteMany({
    where: { userId: { startsWith: prefix } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}
