import {
  AffiliationKind,
  MemberKind,
  PrismaClient,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { backfillMemberAuthority } from './member-authority-backfill';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaClient();
const prefix = 'test:task10:backfill-preflight:';
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
  await clearFixtures();
});

afterAll(async () => {
  await clearFixtures();
  await prisma.$disconnect();
});

it('unapproved legacy/profile mismatch aborts the transaction', async () => {
  const user = await createUser('profile-mismatch');
  await prisma.userProfile.update({
    where: { userId: user.id },
    data: { name: '합성 불일치 이름' },
  });

  await expect(
    backfillMemberAuthority(prisma, { userIdPrefix: user.id }),
  ).rejects.toMatchObject({ kind: 'UNAPPROVED_PROFILE_MISMATCH' });
  await expect(storedUser(user.id)).resolves.toMatchObject({
    hasStaffAccess: null,
    hasAdminAccess: null,
    name: '합성 기존 사용자',
    profile: { name: '합성 불일치 이름' },
  });
});

it('unknown legacy role-selection combination aborts the transaction', async () => {
  const user = await createUser('unknown-selection', MemberKind.STAFF);

  await expect(
    backfillMemberAuthority(prisma, { userIdPrefix: user.id }),
  ).rejects.toMatchObject({ kind: 'UNKNOWN_SELECTION_COMBINATION' });
  await expect(storedUser(user.id)).resolves.toMatchObject({
    selectedMemberKind: MemberKind.STAFF,
    hasStaffAccess: null,
    hasAdminAccess: null,
  });
});

it.each([
  {
    kind: 'canonical-null-contradictory-access',
    expectedErrorKind: 'UNKNOWN_SELECTION_COMBINATION',
  },
  {
    kind: 'staff-profile-student-id',
    expectedErrorKind: 'UNKNOWN_SELECTION_COMBINATION',
  },
  {
    kind: 'affiliation-mirror-mismatch',
    expectedErrorKind: 'UNAPPROVED_PROFILE_MISMATCH',
  },
  {
    kind: 'partial-canonical-fields',
    expectedErrorKind: 'UNKNOWN_SELECTION_COMBINATION',
  },
] as const)(
  '$kind hybrid aborts without writes',
  async ({ kind, expectedErrorKind }) => {
    const user = await createUser(kind);
    await makeHybrid(user.id, kind);
    const before = await storedUser(user.id);

    await expect(
      backfillMemberAuthority(prisma, { userIdPrefix: user.id }),
    ).rejects.toMatchObject({
      kind: expectedErrorKind,
    });
    await expect(storedUser(user.id)).resolves.toEqual(before);
  },
);

async function makeHybrid(
  id: string,
  kind:
    | 'canonical-null-contradictory-access'
    | 'staff-profile-student-id'
    | 'affiliation-mirror-mismatch'
    | 'partial-canonical-fields',
): Promise<void> {
  if (kind === 'canonical-null-contradictory-access') {
    await prisma.user.update({ where: { id }, data: { hasStaffAccess: true } });
    return;
  }
  if (kind === 'affiliation-mirror-mismatch') {
    await prisma.userProfile.update({
      where: { userId: id },
      data: { affiliationName: '합성 불일치 소속' },
    });
    return;
  }
  if (kind === 'partial-canonical-fields') {
    await prisma.user.update({
      where: { id },
      data: { selectedMemberKind: MemberKind.STUDENT },
    });
    return;
  }
  await prisma.user.update({
    where: { id },
    data: {
      role: Role.STAFF,
      selectedRole: Role.STAFF,
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      hasAdminAccess: false,
    },
  });
  await prisma.userProfile.update({
    where: { userId: id },
    data: {
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '합성 운영학과',
    },
  });
}

async function createUser(
  label: string,
  selectedMemberKind: MemberKind | null = null,
) {
  sequence += 1;
  const studentId = `76000${sequence}`;
  return prisma.user.create({
    data: {
      id: `${prefix}${label}:${sequence}`,
      githubId: 9_921_000_000n + BigInt(sequence),
      nickname: `synthetic-task10-preflight-${sequence}`,
      role: Role.STUDENT,
      selectedRole: Role.STUDENT,
      selectedMemberKind,
      hasStaffAccess: null,
      hasAdminAccess: null,
      name: '합성 기존 사용자',
      studentId,
      department: '합성 운영학과',
      profile: {
        create: {
          name: '합성 기존 사용자',
          studentId,
          department: '합성 운영학과',
          memberKind: null,
        },
      },
    },
    select: { id: true },
  });
}

function storedUser(id: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id },
    include: { profile: true },
  });
}

async function clearFixtures(): Promise<void> {
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}
