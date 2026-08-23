import { AffiliationKind, MemberKind, Role } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { LegacyMemberReclassificationRepository } from '../src/users/legacy-member-reclassification.repository';
import {
  type LegacyMemberReclassificationInput,
  LegacyMemberReclassificationService,
} from '../src/users/legacy-member-reclassification.service';
import {
  backfillMemberAuthority,
  readMemberAuthorityStatus,
} from './member-authority-backfill';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const service = new LegacyMemberReclassificationService(
  new LegacyMemberReclassificationRepository(prisma),
);
const prefix = 'test:task10:terminal-state:';
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
  await clearFixtures();
});

afterAll(async () => {
  await clearFixtures();
  await prisma.$disconnect();
});

it('status reports endpoint-equivalent STUDENT and STAFF terminal states as zero-change', async () => {
  // Given
  const exactPrefix = await createTerminalSet('status');

  // When
  const status = await readMemberAuthorityStatus(prisma, {
    userIdPrefix: exactPrefix,
  });

  // Then
  expect(status).toMatchObject({
    aggregate: {
      legacyRoles: { ADMIN: 5 },
      memberKinds: { STUDENT: 3, STAFF: 2, UNRESOLVED_ASSIGNED: 0 },
      compatibilityOnlyAdminAuthorities: 0,
    },
    expected: {
      changedUsers: 0,
      changedProfiles: 0,
      createdProfiles: 0,
    },
  });
});

it('apply keeps endpoint-equivalent STUDENT and STAFF terminal states byte-equivalent', async () => {
  // Given
  const exactPrefix = await createTerminalSet('apply');
  const before = await storedUsers(exactPrefix);

  // When
  const applied = await backfillMemberAuthority(prisma, {
    userIdPrefix: exactPrefix,
  });

  // Then
  expect(applied).toMatchObject({ changedUsers: 0, changedProfiles: 0 });
  await expect(storedUsers(exactPrefix)).resolves.toEqual(before);
  expect(
    before.map((user) => [
      user.role,
      user.selectedRole,
      user.selectedMemberKind,
      user.hasStaffAccess,
      user.hasAdminAccess,
      user.profile?.affiliationKind,
      user.studentId === user.profile?.studentId,
    ]),
  ).toEqual([
    [Role.ADMIN, null, MemberKind.STAFF, true, true, 'DEPARTMENT', true],
    [
      Role.ADMIN,
      Role.STAFF,
      MemberKind.STAFF,
      true,
      true,
      'PROGRAM_OFFICE',
      true,
    ],
    [Role.ADMIN, null, MemberKind.STUDENT, false, true, 'DEPARTMENT', true],
    [Role.ADMIN, null, MemberKind.STUDENT, false, true, 'DEPARTMENT', true],
    [Role.ADMIN, null, MemberKind.STUDENT, false, true, 'DEPARTMENT', true],
  ]);
});

const hybridCases = [
  {
    label: 'student-staff-access',
    input: studentInput('748020'),
    data: { hasStaffAccess: true },
  },
  {
    label: 'staff-admin-access',
    input: staffInput(AffiliationKind.PROGRAM_OFFICE),
    data: { hasAdminAccess: false },
  },
] as const;

it.each(hybridCases)(
  'status rejects one-field hybrid: $label',
  async (test) => {
    // Given
    const user = await createHybrid(test);

    // When
    const status = readMemberAuthorityStatus(prisma, { userIdPrefix: user.id });

    // Then
    await expect(status).rejects.toMatchObject({
      kind: 'UNKNOWN_SELECTION_COMBINATION',
    });
  },
);

it.each(hybridCases)('apply rejects one-field hybrid: $label', async (test) => {
  // Given
  const user = await createHybrid(test);
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });

  // When
  const apply = backfillMemberAuthority(prisma, { userIdPrefix: user.id });

  // Then
  await expect(apply).rejects.toMatchObject({
    kind: 'UNKNOWN_SELECTION_COMBINATION',
  });
  await expect(
    prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
  ).resolves.toEqual(before);
});

async function createTerminalSet(lane: string): Promise<string> {
  const exactPrefix = `${prefix}exact:${lane}:`;
  const staffDepartment = await createLegacyAdmin(
    `exact:${lane}:staff-department`,
  );
  const staffProgram = await createLegacyAdmin(`exact:${lane}:staff-program`);
  await service.reclassify(
    staffDepartment.githubId,
    staffInput(AffiliationKind.DEPARTMENT),
  );
  await service.reclassify(
    staffProgram.githubId,
    staffInput(AffiliationKind.PROGRAM_OFFICE),
  );
  await prisma.user.update({
    where: { id: staffProgram.id },
    data: { selectedRole: Role.STAFF },
  });
  for (const studentIndex of [1, 2, 3] as const) {
    const student = await createLegacyAdmin(
      `exact:${lane}:student-${studentIndex}`,
    );
    await service.reclassify(
      student.githubId,
      studentInput(`7482${sequence.toString().padStart(2, '0')}`),
    );
  }
  return exactPrefix;
}

async function createHybrid(test: (typeof hybridCases)[number]) {
  const user = await createLegacyAdmin(`hybrid:${test.label}`);
  switch (test.input.memberKind) {
    case MemberKind.STUDENT:
      await service.reclassify(user.githubId, {
        ...test.input,
        studentId: `7481${sequence.toString().padStart(2, '0')}`,
      });
      break;
    case MemberKind.STAFF:
      await service.reclassify(user.githubId, test.input);
      break;
  }
  await prisma.user.update({ where: { id: user.id }, data: test.data });
  return user;
}

async function createLegacyAdmin(label: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      id: `${prefix}${label}:${sequence}`,
      githubId: 9_927_000_000n + BigInt(sequence),
      nickname: `synthetic-terminal-state-${sequence}`,
      role: Role.ADMIN,
      selectedRole: null,
      selectedMemberKind: null,
      hasStaffAccess: true,
      hasAdminAccess: true,
      name: '합성 기존 관리자',
      studentId: null,
      department: '합성 운영학과',
      profile: {
        create: {
          name: '합성 기존 관리자',
          studentId: null,
          department: '합성 운영학과',
          memberKind: null,
          affiliationKind: null,
          affiliationName: null,
        },
      },
    },
    select: { id: true, githubId: true },
  });
}

function studentInput(studentId: string): LegacyMemberReclassificationInput {
  return {
    memberKind: MemberKind.STUDENT,
    name: '  합성 terminal 학생  ',
    studentId,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: '  합성 terminal 학과  ',
  };
}

function staffInput(
  affiliationKind: AffiliationKind,
): LegacyMemberReclassificationInput {
  const affiliationName = {
    [AffiliationKind.DEPARTMENT]: '  합성 terminal 학과  ',
    [AffiliationKind.PROGRAM_OFFICE]: '  합성 terminal 사업단  ',
  } satisfies Readonly<Record<AffiliationKind, string>>;
  return {
    memberKind: MemberKind.STAFF,
    name: '  합성 terminal 교직원  ',
    affiliationKind,
    affiliationName: affiliationName[affiliationKind],
  };
}

function storedUsers(userIdPrefix: string) {
  return prisma.user.findMany({
    where: { id: { startsWith: userIdPrefix } },
    include: { profile: true },
    orderBy: { id: 'asc' },
  });
}

async function clearFixtures(): Promise<void> {
  await prisma.roleRequest.deleteMany({
    where: { userId: { startsWith: prefix } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}
