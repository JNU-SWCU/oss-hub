import { Inject, Injectable } from '@nestjs/common';
import { MemberKind, Prisma, StaffAccessRequestStatus } from '@prisma/client';
import { AuditLogService } from '../audit-log/service/audit-log.service';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import { PrismaService } from '../prisma/prisma.service';
import {
  fillStudentIdIfEmpty,
  type StudentIdFillOutcome,
} from '../profiles/user-profile-write.repository';
import { requestStaffAccess } from './repository/staff-access-request';
import {
  USER_PHONE_AUDIT_TRANSITIONS,
  USER_PROFILE_AUDIT_ACTIONS,
  USER_PROFILE_AUDIT_FIELDS,
  createUserPhoneAuditMetadata,
  createUserProfileAuditMetadata,
} from '../audit-log/domain/audit-log-metadata';
import type {
  CompleteUserProfileInput,
  UpdateProfileFieldsInput,
  UserProfileRecord,
} from './domain/user-profile';

export type { StudentIdFillOutcome };
export type ProfileCompletionOutcome =
  'completed' | 'conflict' | 'student-id-taken';

const PROFILE_MEMBER_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  phone: true,
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  profile: {
    select: {
      name: true,
      studentId: true,
      department: true,
      memberKind: true,
      affiliationKind: true,
      affiliationName: true,
      staffNumber: true,
    },
  },
  staffAccessRequests: {
    where: { status: StaffAccessRequestStatus.PENDING },
    select: { id: true },
    take: 1,
  },
} as const satisfies Prisma.UserSelect;

type ProfileMemberRow = Prisma.UserGetPayload<{
  select: typeof PROFILE_MEMBER_SELECT;
}>;

export interface UsersRepositoryPort {
  findByGithubId(githubId: bigint): Promise<UserProfileRecord | null>;
  completeProfileIfUnchanged(
    expected: UserProfileRecord,
    input: CompleteUserProfileInput,
  ): Promise<ProfileCompletionOutcome>;
  fillStudentId(input: FillStudentIdInput): Promise<StudentIdFillOutcome>;
  updateProfileFields(
    expected: UserProfileRecord,
    fields: UpdateProfileFieldsInput,
  ): Promise<void>;
}

export interface FillStudentIdInput {
  readonly expected: UserProfileRecord;
  readonly studentId: string;
  readonly phone?: string;
}

@Injectable()
export class UsersRepository implements UsersRepositoryPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,

    @Inject(AuditLogService)
    private readonly auditLog: Pick<AuditLogService, 'record'>,
  ) {}

  async findByGithubId(githubId: bigint): Promise<UserProfileRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: PROFILE_MEMBER_SELECT,
    });
    return user ? toUserProfileRecord(user) : null;
  }

  async completeProfileIfUnchanged(
    expected: UserProfileRecord,
    input: CompleteUserProfileInput,
  ): Promise<ProfileCompletionOutcome> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${expected.id} FOR UPDATE`,
        );
        const current = await transaction.user.findUnique({
          where: { id: expected.id },
          select: PROFILE_MEMBER_SELECT,
        });
        if (
          !current ||
          !sameProfileSnapshot(toUserProfileRecord(current), expected)
        ) {
          return 'conflict';
        }
        const profile = profileWrite(input);
        await transaction.userProfile.upsert({
          where: { userId: expected.id },
          update: profile,
          create: { userId: expected.id, ...profile },
        });
        await transaction.user.update({
          where: { id: expected.id },
          data: {
            selectedMemberKind: input.memberKind,
            hasStaffAccess: input.hasStaffAccess,
            hasAdminAccess: input.hasAdminAccess,
          },
        });
        await writeUserPhoneIfChanged(
          transaction,
          this.auditLog,
          expected,
          input.phone,
        );
        await requestStaffAccess(transaction, {
          id: expected.id,
          memberKind: input.memberKind,
          hasStaffAccess: input.hasStaffAccess,
        });
        return 'completed';
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      if (input.studentId === null) {
        return 'conflict';
      }
      const owner = await this.prisma.userProfile.findUnique({
        where: { studentId: input.studentId },
        select: { userId: true },
      });
      return owner !== null && owner.userId !== expected.id
        ? 'student-id-taken'
        : 'conflict';
    }
  }

  fillStudentId(input: FillStudentIdInput): Promise<StudentIdFillOutcome> {
    return this.prisma.$transaction(async (transaction) => {
      const outcome = await fillStudentIdIfEmpty(
        transaction,
        input.expected.id,
        input.studentId,
      );
      if (outcome !== 'filled') {
        return outcome;
      }
      await writeUserPhoneIfChanged(
        transaction,
        this.auditLog,
        input.expected,
        input.phone,
      );
      return outcome;
    });
  }

  async updateProfileFields(
    expected: UserProfileRecord,
    fields: UpdateProfileFieldsInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const staffNumberBefore =
        fields.staffNumber === undefined
          ? undefined
          : await lockStaffNumber(transaction, expected.id);
      await transaction.userProfile.update({
        where: { userId: expected.id },
        data: {
          name: fields.name,
          department: fields.department,
          affiliationName: fields.affiliationName ?? fields.department,
          ...(fields.affiliationKind === undefined
            ? {}
            : { affiliationKind: fields.affiliationKind }),
          ...(fields.staffNumber === undefined
            ? {}
            : { staffNumber: fields.staffNumber }),
        },
      });
      if (fields.staffNumber !== undefined) {
        await writeStaffNumberAuditIfChanged(
          transaction,
          this.auditLog,
          expected,
          staffNumberBefore ?? null,
          fields.staffNumber,
        );
      }
      await writeUserPhoneIfChanged(
        transaction,
        this.auditLog,
        expected,
        fields.phone,
      );
    });
  }
}

async function writeUserPhoneIfChanged(
  transaction: Prisma.TransactionClient,
  auditLog: Pick<AuditLogService, 'record'>,
  user: UserProfileRecord,
  phone: string | undefined,
): Promise<void> {
  if (phone === undefined) {
    return;
  }
  const rows = await transaction.$queryRaw<{ phone: string | null }[]>(
    Prisma.sql`SELECT "phone" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`,
  );
  const locked = rows.at(0);
  if (!locked) {
    throw new Error('Phone updates require an existing user row.');
  }
  if (locked.phone === phone) {
    return;
  }
  if (
    typeof user.githubId !== 'bigint' ||
    typeof user.githubLogin !== 'string'
  ) {
    throw new TypeError(
      'Phone updates require a full user profile record for auditing.',
    );
  }
  await transaction.user.update({
    where: { id: user.id },
    data: { phone },
  });
  await auditLog.record(
    {
      actorGithubId: user.githubId,
      action: USER_PROFILE_AUDIT_ACTIONS.PHONE_UPDATED,
      targetType: 'USER',
      targetId: user.id,
      metadata: createUserPhoneAuditMetadata({
        actor: { displayName: user.name, githubLogin: user.githubLogin },
        target: { displayName: user.name, githubLogin: user.githubLogin },
        transition:
          locked.phone === null
            ? USER_PHONE_AUDIT_TRANSITIONS.SET
            : USER_PHONE_AUDIT_TRANSITIONS.REPLACED,
      }),
    },
    transaction,
  );
}

async function lockStaffNumber(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<string | null> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`,
  );
  const rows = await transaction.$queryRaw<
    { staffNumber: string | null; memberKind: MemberKind }[]
  >(
    Prisma.sql`SELECT "staffNumber", "memberKind" FROM "UserProfile" WHERE "userId" = ${userId} FOR UPDATE`,
  );
  const row = rows.at(0);
  if (!row) {
    throw new Error('Staff number updates require an existing profile row.');
  }
  if (row.memberKind !== MemberKind.STAFF) {
    throw new DomainException({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
      message: '교직원 번호는 교직원만 수정할 수 있습니다.',
    });
  }
  return row.staffNumber;
}

async function writeStaffNumberAuditIfChanged(
  transaction: Prisma.TransactionClient,
  auditLog: Pick<AuditLogService, 'record'>,
  user: UserProfileRecord,
  before: string | null,
  after: string | null,
): Promise<void> {
  if (before === after) {
    return;
  }
  if (
    typeof user.githubId !== 'bigint' ||
    typeof user.githubLogin !== 'string'
  ) {
    throw new TypeError(
      'Staff number updates require a full user profile record for auditing.',
    );
  }
  await auditLog.record(
    {
      actorGithubId: user.githubId,
      action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
      targetType: 'USER',
      targetId: user.id,
      metadata: createUserProfileAuditMetadata({
        actor: { displayName: user.name, githubLogin: user.githubLogin },
        target: { displayName: user.name, githubLogin: user.githubLogin },
        changes: [
          {
            field: USER_PROFILE_AUDIT_FIELDS.STAFF_NUMBER,
            before,
            after,
          },
        ],
      }),
    },
    transaction,
  );
}

function toUserProfileRecord(user: ProfileMemberRow): UserProfileRecord {
  const profile = user.profile;
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: profile?.name ?? null,
    studentId: profile?.studentId ?? null,
    department: profile?.department ?? null,
    phone: user.phone ?? null,
    staffNumber: profile?.staffNumber ?? null,
    selectedMemberKind: user.selectedMemberKind,
    memberKind: profile?.memberKind ?? null,
    affiliationKind: profile?.affiliationKind ?? null,
    affiliationName: profile?.affiliationName ?? null,
    hasStaffAccess: user.hasStaffAccess,
    hasAdminAccess: user.hasAdminAccess,
    hasPendingStaffRequest: user.staffAccessRequests.length > 0,
  };
}

function sameProfileSnapshot(
  current: UserProfileRecord,
  expected: UserProfileRecord,
): boolean {
  return (
    current.name === expected.name &&
    current.studentId === expected.studentId &&
    current.department === expected.department &&
    current.phone === expected.phone &&
    (current.staffNumber ?? null) === (expected.staffNumber ?? null) &&
    current.selectedMemberKind === expected.selectedMemberKind &&
    current.memberKind === expected.memberKind &&
    current.affiliationKind === expected.affiliationKind &&
    current.affiliationName === expected.affiliationName &&
    current.hasStaffAccess === expected.hasStaffAccess &&
    current.hasAdminAccess === expected.hasAdminAccess
  );
}

function profileWrite(input: CompleteUserProfileInput) {
  return {
    name: input.name,
    studentId: input.studentId,
    department: input.department,
    memberKind: input.memberKind,
    affiliationKind: input.affiliationKind,
    affiliationName: input.affiliationName,
  };
}
