import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  Prisma,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  INDEPENDENT_AUTHORITY_AUDIT_ACTIONS,
  USER_PROFILE_AUDIT_ACTIONS,
} from '../audit-log/domain/audit-log-metadata';
import { AuditLogRepository } from '../audit-log/repository/audit-log.repository';
import { AuditLogService } from '../audit-log/service/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemberKindRepository } from './member-kind.repository';
import { MemberKindService } from './member-kind.service';
import { UsersErrorCode } from './users-error-code.enum';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const FIXTURE_PREFIX = 'test:member-kind:';
const prisma = new PrismaService();
const service = new MemberKindService(
  new MemberKindRepository(prisma),
  new AuditLogService(new AuditLogRepository(prisma)),
);
let sequence = 0;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  try {
    await prisma.userProfile.deleteMany({
      where: { userId: { startsWith: FIXTURE_PREFIX } },
    });
  } finally {
    await prisma.$disconnect();
  }
});

describe('member-kind persistence contract', () => {
  it('maps STAFF to access=true, preserves studentId, and saves/clears opaque staffNumber', async () => {
    const actor = await createUser('staff-number-actor', {
      memberKind: null,
      hasAdminAccess: true,
    });
    const target = await createUser('staff-number-target', {
      memberKind: MemberKind.STUDENT,
      studentId: '968600',
    });

    await expect(
      service.patchMemberKind(actor.githubId, target.id, {
        memberKind: MemberKind.STAFF,
        expectedMemberKind: MemberKind.STUDENT,
        expectedHasStaffAccess: false,
        staffNumber: ' 직원-A7 ',
      }),
    ).resolves.toMatchObject({
      role: 'STAFF',
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      hasAdminAccess: false,
    });
    await expect(readUser(target.id)).resolves.toMatchObject({
      hasStaffAccess: true,
      hasAdminAccess: false,
      profile: {
        studentId: '968600',
        memberKind: MemberKind.STAFF,
        staffNumber: '직원-A7',
      },
    });

    await expect(
      service.patchMemberKind(actor.githubId, target.id, {
        memberKind: MemberKind.STAFF,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        staffNumber: null,
      }),
    ).resolves.toMatchObject({ hasStaffAccess: true });
    await expect(readUser(target.id)).resolves.toMatchObject({
      hasStaffAccess: true,
      profile: { studentId: '968600', staffNumber: null },
    });
    await expect(
      prisma.auditLog.count({
        where: {
          targetId: target.id,
          action: INDEPENDENT_AUTHORITY_AUDIT_ACTIONS.SET_MEMBER_KIND,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          targetId: target.id,
          action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
        },
      }),
    ).resolves.toBe(2);
  });

  it('maps STAFF to STUDENT while retaining a legacy studentId and normalizing department affinity', async () => {
    const actor = await createUser('student-transition-actor', {
      memberKind: null,
      hasAdminAccess: true,
    });
    const target = await createUser('student-transition-target', {
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      studentId: '9686001234',
      department: '기존 소속',
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
    });

    await expect(
      service.patchMemberKind(actor.githubId, target.id, {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        department: '  소프트웨어공학과  ',
      }),
    ).resolves.toMatchObject({
      role: 'STUDENT',
      memberKind: MemberKind.STUDENT,
      hasStaffAccess: false,
    });
    await expect(readUser(target.id)).resolves.toMatchObject({
      hasStaffAccess: false,
      profile: {
        name: '합성 student-transition-target',
        studentId: '9686001234',
        department: '소프트웨어공학과',
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: '소프트웨어공학과',
      },
    });
    await expect(
      prisma.auditLog.count({
        where: {
          targetId: target.id,
          action: INDEPENDENT_AUTHORITY_AUDIT_ACTIONS.SET_MEMBER_KIND,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          targetId: target.id,
          action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
        },
      }),
    ).resolves.toBe(1);
  });

  it('rejects a supplied studentId that replaces an existing studentId without writes', async () => {
    const actor = await createUser('student-id-replacement-actor', {
      memberKind: null,
      hasAdminAccess: true,
    });
    const target = await createUser('student-id-replacement-target', {
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      studentId: '968610',
    });

    await expectProblem(
      service.patchMemberKind(actor.githubId, target.id, {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        studentId: '968611',
        department: '소프트웨어공학과',
      }),
      'SYS_003',
      400,
    );

    await expect(readUser(target.id)).resolves.toMatchObject({
      hasStaffAccess: true,
      profile: {
        memberKind: MemberKind.STAFF,
        studentId: '968610',
        department: '합성 학과',
      },
    });
    await expect(
      prisma.staffAccessRequest.count({ where: { userId: target.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({ where: { targetId: target.id } }),
    ).resolves.toBe(0);
  });

  it('rejects a missing stored studentId, a missing department, and an invalid new studentId', async () => {
    const actor = await createUser('student-validation-actor', {
      memberKind: null,
      hasAdminAccess: true,
    });
    const missingId = await createUser('student-validation-missing-id', {
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      studentId: null,
    });
    const missingDepartment = await createUser(
      'student-validation-missing-department',
      {
        memberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        studentId: '968601',
      },
    );
    const invalidNewId = await createUser('student-validation-invalid-id', {
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      studentId: '968602',
    });

    await expectProblem(
      service.patchMemberKind(actor.githubId, missingId.id, {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        department: '소프트웨어공학과',
      }),
      UsersErrorCode.PROFILE_INCOMPLETE,
      409,
    );
    await expectProblem(
      service.patchMemberKind(actor.githubId, missingDepartment.id, {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
      }),
      UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT,
      400,
    );
    await expectProblem(
      service.patchMemberKind(actor.githubId, invalidNewId.id, {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        studentId: 'not-a-student-id',
        department: '소프트웨어공학과',
      }),
      'SYS_003',
      400,
    );

    await expect(readUser(missingId.id)).resolves.toMatchObject({
      hasStaffAccess: true,
      profile: { memberKind: MemberKind.STAFF, studentId: null },
    });
    await expect(readUser(missingDepartment.id)).resolves.toMatchObject({
      hasStaffAccess: true,
      profile: { memberKind: MemberKind.STAFF, studentId: '968601' },
    });
    await expect(readUser(invalidNewId.id)).resolves.toMatchObject({
      hasStaffAccess: true,
      profile: { memberKind: MemberKind.STAFF, studentId: '968602' },
    });
  });

  it('rejects a canonical profile that is incomplete under the current profile policy', async () => {
    const actor = await createUser('incomplete-profile-actor', {
      memberKind: null,
      hasAdminAccess: true,
    });
    const target = await createUser('incomplete-profile-target', {
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      name: String.fromCodePoint(0xa0),
    });

    await expectProblem(
      service.patchMemberKind(actor.githubId, target.id, {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        department: '소프트웨어공학과',
      }),
      UsersErrorCode.PROFILE_INCOMPLETE,
      409,
    );
    await expect(readUser(target.id)).resolves.toMatchObject({
      hasStaffAccess: true,
      profile: {
        name: String.fromCodePoint(0xa0),
        memberKind: MemberKind.STAFF,
      },
    });
  });

  it('maps a duplicate studentId to 409 and rolls back the attempted transition', async () => {
    const actor = await createUser('duplicate-actor', {
      memberKind: null,
      hasAdminAccess: true,
    });
    const owner = await createUser('duplicate-owner', {
      memberKind: MemberKind.STUDENT,
      studentId: '968603',
    });
    const target = await createUser('duplicate-target', {
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      studentId: null,
    });

    await expectProblem(
      service.patchMemberKind(actor.githubId, target.id, {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        studentId: '968603',
        department: '소프트웨어공학과',
      }),
      UsersErrorCode.STUDENT_ID_TAKEN_BY_ADMIN,
      409,
    );
    await expect(readUser(target.id)).resolves.toMatchObject({
      hasStaffAccess: true,
      profile: { memberKind: MemberKind.STAFF, studentId: null },
    });
    await expect(readUser(owner.id)).resolves.toMatchObject({
      profile: { memberKind: MemberKind.STUDENT, studentId: '968603' },
    });
    await expect(
      prisma.auditLog.count({ where: { targetId: target.id } }),
    ).resolves.toBe(0);
  });

  it('preserves name, admin access, and account status independently of member kind', async () => {
    const actor = await createUser('independent-actor', {
      memberKind: null,
      hasAdminAccess: true,
    });
    const target = await createUser('independent-target', {
      memberKind: MemberKind.STUDENT,
      hasAdminAccess: true,
      accountStatus: AccountStatus.DEACTIVATED,
      name: '합성 보존 이름',
      studentId: '968605',
      department: '합성 학과',
    });

    await expect(
      service.patchMemberKind(actor.githubId, target.id, {
        memberKind: MemberKind.STAFF,
        expectedMemberKind: MemberKind.STUDENT,
        expectedHasStaffAccess: false,
        staffNumber: '교직원-A7',
      }),
    ).resolves.toMatchObject({
      role: 'ADMIN',
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      hasAdminAccess: true,
    });
    await expect(readUser(target.id)).resolves.toMatchObject({
      accountStatus: AccountStatus.DEACTIVATED,
      hasAdminAccess: true,
      hasStaffAccess: true,
      profile: {
        name: '합성 보존 이름',
        studentId: '968605',
        department: '합성 학과',
        staffNumber: '교직원-A7',
      },
    });
  });

  it('rolls back user, profile, history, and audit state when the audit writer fails', async () => {
    const actor = await createUser('audit-failure-actor', {
      memberKind: null,
      hasAdminAccess: true,
    });
    const target = await createUser('audit-failure-target', {
      memberKind: MemberKind.STUDENT,
      studentId: '968606',
    });
    const failingService = new MemberKindService(
      new MemberKindRepository(prisma),
      {
        record: jest
          .fn()
          .mockRejectedValue(new Error('synthetic audit failure')),
      },
    );

    await expect(
      failingService.patchMemberKind(actor.githubId, target.id, {
        memberKind: MemberKind.STAFF,
        expectedMemberKind: MemberKind.STUDENT,
        expectedHasStaffAccess: false,
        staffNumber: '교직원-실패',
      }),
    ).rejects.toThrow('synthetic audit failure');

    await expect(readUser(target.id)).resolves.toMatchObject({
      hasStaffAccess: false,
      profile: {
        memberKind: MemberKind.STUDENT,
        studentId: '968606',
        staffNumber: null,
      },
    });
    await expect(
      prisma.staffAccessRequest.count({ where: { userId: target.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({ where: { targetId: target.id } }),
    ).resolves.toBe(0);
  });

  it('blocks pending requests and absent canonical profiles before any database write', async () => {
    const actor = await createUser('blocked-state-actor', {
      memberKind: null,
      hasAdminAccess: true,
    });
    const absent = await createUser('blocked-absent-profile', {
      memberKind: null,
    });
    const pending = await createUser('blocked-pending-profile', {
      memberKind: MemberKind.STUDENT,
      studentId: '968607',
    });
    await prisma.staffAccessRequest.create({
      data: {
        id: `${pending.id}:pending`,
        userId: pending.id,
        status: StaffAccessRequestStatus.PENDING,
      },
    });

    await expectProblem(
      service.patchMemberKind(actor.githubId, absent.id, {
        memberKind: MemberKind.STAFF,
        expectedMemberKind: MemberKind.STUDENT,
        expectedHasStaffAccess: false,
      }),
      UsersErrorCode.PROFILE_INCOMPLETE,
      409,
    );
    await expectProblem(
      service.patchMemberKind(actor.githubId, pending.id, {
        memberKind: MemberKind.STAFF,
        expectedMemberKind: MemberKind.STUDENT,
        expectedHasStaffAccess: false,
      }),
      'ROL_015',
      409,
    );
    await expect(readUser(pending.id)).resolves.toMatchObject({
      hasStaffAccess: false,
      profile: { memberKind: MemberKind.STUDENT, studentId: '968607' },
    });
  });

  it('records one REVOKED request for true-to-false staff revocation and repairs same-kind flags without history', async () => {
    const actor = await createUser('revocation-actor', {
      memberKind: null,
      hasAdminAccess: true,
    });
    const revoked = await createUser('revocation-target', {
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      studentId: '968608',
    });
    const repair = await createUser('repair-target', {
      memberKind: MemberKind.STAFF,
      hasStaffAccess: false,
      studentId: '968609',
    });

    await expect(
      service.patchMemberKind(actor.githubId, revoked.id, {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        department: '소프트웨어공학과',
      }),
    ).resolves.toMatchObject({ hasStaffAccess: false });
    await expect(
      prisma.staffAccessRequest.findMany({
        where: { userId: revoked.id },
        orderBy: { id: 'asc' },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        status: StaffAccessRequestStatus.REVOKED,
        decidedById: actor.id,
      }),
    ]);

    await expect(
      service.patchMemberKind(actor.githubId, repair.id, {
        memberKind: MemberKind.STAFF,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: false,
      }),
    ).resolves.toMatchObject({ hasStaffAccess: true });
    await expect(
      prisma.staffAccessRequest.count({ where: { userId: repair.id } }),
    ).resolves.toBe(0);
  });
});

async function createUser(
  label: string,
  options: {
    readonly memberKind: MemberKind | null;
    readonly hasStaffAccess?: boolean;
    readonly hasAdminAccess?: boolean;
    readonly accountStatus?: AccountStatus;
    readonly name?: string;
    readonly studentId?: string | null;
    readonly department?: string;
    readonly affiliationKind?: AffiliationKind;
  },
): Promise<{ readonly id: string; readonly githubId: bigint }> {
  sequence += 1;
  const id = `${FIXTURE_PREFIX}${label}:${sequence}`;
  const githubId = 9_700_700_000n + BigInt(sequence);
  const data = {
    id,
    githubId,
    nickname: `synthetic-${label}-${sequence}`,
    accountStatus: options.accountStatus ?? AccountStatus.ACTIVE,
    selectedMemberKind: options.memberKind,
    hasStaffAccess:
      options.hasStaffAccess ?? options.memberKind === MemberKind.STAFF,
    hasAdminAccess: options.hasAdminAccess ?? false,
    ...(options.memberKind === null
      ? {}
      : {
          profile: {
            create: {
              name: options.name ?? `합성 ${label}`,
              studentId:
                options.studentId === undefined
                  ? options.memberKind === MemberKind.STUDENT
                    ? '968600'
                    : null
                  : options.studentId,
              department: options.department ?? '합성 학과',
              staffNumber: null,
              memberKind: options.memberKind,
              affiliationKind:
                options.affiliationKind ?? AffiliationKind.DEPARTMENT,
              affiliationName: options.department ?? '합성 학과',
            },
          },
        }),
  } satisfies Prisma.UserCreateInput;
  await prisma.user.create({ data });
  return { id, githubId };
}

function readUser(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true },
  });
}

async function expectProblem(
  operation: Promise<unknown>,
  code: UsersErrorCode | string,
  status: number,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    errorCode: { code, status },
  });
}
