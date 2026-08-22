import {
  AffiliationKind,
  MemberKind,
  PrismaClient,
  Role,
  RoleRequestStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import {
  backfillMemberAuthority,
  readMemberAuthorityStatus,
} from './member-authority-backfill';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaClient();
const prefix = 'test:task10:selection-v1-applied:';

beforeAll(async () => {
  await prisma.$connect();
  await clearFixtures();
  const studentApproved = await createOnceAppliedStudent('approved', 1);
  await createOnceAppliedStudent('without-request', 2);
  const adminApproved = await createOnceAppliedAdmin('approved', Role.STAFF, 3);
  await createOnceAppliedAdmin('retained-null', null, 4);
  await prisma.roleRequest.createMany({
    data: [studentApproved.id, adminApproved.id].map((userId, index) => ({
      id: `${prefix}request:${index + 1}`,
      userId,
      status: RoleRequestStatus.APPROVED,
      decidedById: adminApproved.id,
    })),
  });
});

afterAll(async () => {
  await clearFixtures();
  await prisma.$disconnect();
});

it('status -> apply -> status -> apply repairs exactly three v1 selection conflicts', async () => {
  const before = await readMemberAuthorityStatus(prisma, {
    userIdPrefix: prefix,
  });
  const first = await backfillMemberAuthority(prisma, {
    userIdPrefix: prefix,
  });
  const after = await readMemberAuthorityStatus(prisma, {
    userIdPrefix: prefix,
  });
  const second = await backfillMemberAuthority(prisma, {
    userIdPrefix: prefix,
  });

  expect(before).toMatchObject({
    version: '20260822-member-authority-v2',
    expected: { changedUsers: 3, changedProfiles: 0, createdProfiles: 0 },
  });
  expect(first).toMatchObject({
    version: '20260822-member-authority-v2',
    changedUsers: 3,
    changedProfiles: 0,
    createdProfiles: 0,
    before: { requests: 2, requestStatuses: { APPROVED: 2 } },
  });
  expect(after).toMatchObject({
    version: '20260822-member-authority-v2',
    expected: { changedUsers: 0, changedProfiles: 0, createdProfiles: 0 },
  });
  expect(second).toMatchObject({ changedUsers: 0, changedProfiles: 0 });
  await expect(
    prisma.user.findMany({
      where: { id: { startsWith: prefix } },
      select: { role: true, selectedMemberKind: true },
      orderBy: { id: 'asc' },
    }),
  ).resolves.toEqual([
    { role: Role.ADMIN, selectedMemberKind: null },
    { role: Role.ADMIN, selectedMemberKind: null },
    { role: Role.STUDENT, selectedMemberKind: MemberKind.STUDENT },
    { role: Role.STUDENT, selectedMemberKind: MemberKind.STUDENT },
  ]);
});

async function createOnceAppliedStudent(label: string, sequence: number) {
  const name = `합성 선택 학생 ${sequence}`;
  const studentId = `78100${sequence}`;
  const department = '합성 선택학과';
  return prisma.user.create({
    data: {
      id: `${prefix}student:${label}`,
      githubId: 9_923_000_000n + BigInt(sequence),
      nickname: `synthetic-selection-student-${sequence}`,
      role: Role.STUDENT,
      selectedRole: Role.STAFF,
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: false,
      hasAdminAccess: false,
      name,
      studentId,
      department,
      profile: {
        create: {
          name,
          studentId,
          department,
          memberKind: MemberKind.STUDENT,
          affiliationKind: AffiliationKind.DEPARTMENT,
          affiliationName: department,
        },
      },
    },
    select: { id: true },
  });
}

async function createOnceAppliedAdmin(
  label: string,
  selectedRole: Role | null,
  sequence: number,
) {
  const name = `합성 선택 관리자 ${sequence}`;
  const department = '합성 선택 운영학과';
  return prisma.user.create({
    data: {
      id: `${prefix}admin:${label}`,
      githubId: 9_923_000_000n + BigInt(sequence),
      nickname: `synthetic-selection-admin-${sequence}`,
      role: Role.ADMIN,
      selectedRole,
      selectedMemberKind: selectedRole === Role.STAFF ? MemberKind.STAFF : null,
      hasStaffAccess: true,
      hasAdminAccess: true,
      name,
      studentId: null,
      department,
      profile: {
        create: {
          name,
          studentId: null,
          department,
          memberKind: null,
          affiliationKind: null,
          affiliationName: null,
        },
      },
    },
    select: { id: true },
  });
}

async function clearFixtures(): Promise<void> {
  await prisma.roleRequest.deleteMany({
    where: { userId: { startsWith: prefix } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}
