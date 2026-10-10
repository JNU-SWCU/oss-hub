import { Inject, Injectable } from '@nestjs/common';
import { MemberKind, Prisma, StaffAccessRequestStatus } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../../prisma/audit-log-transaction-writer';
import { DomainException } from '../../common/error-code';
import { SystemErrorCode } from '../../common/system-error-code.enum';
import { PrismaService } from '../../prisma/prisma.service';
import {
  fillStudentIdIfEmpty,
  type StudentIdFillOutcome,
} from '../../profiles/repository/user-profile-write.repository';
import { requestStaffAccess } from './staff-access-request';
import type {
  CompleteUserProfileInput,
  UpdateProfileFieldsInput,
  UserProfileRecord,
} from '../domain/user-profile';

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

type AuditWriterStore = {
  readonly auditLogWriter: AuditLogTransactionWriter;
};

type PhoneAuditTransition = 'set' | 'replaced';

type AuditableUserProfileRecord = UserProfileRecord & {
  readonly githubId: bigint;
  readonly githubLogin: string;
};

export type RecordPhoneAudit = (
  store: AuditWriterStore,
  change: {
    readonly user: AuditableUserProfileRecord;
    readonly transition: PhoneAuditTransition;
  },
) => Promise<void>;

export type RecordStaffNumberAudit = (
  store: AuditWriterStore,
  change: {
    readonly user: AuditableUserProfileRecord;
    readonly before: string | null;
    readonly after: string | null;
  },
) => Promise<void>;

export interface UsersRepositoryPort {
  findByGithubId(githubId: bigint): Promise<UserProfileRecord | null>;
  completeProfileIfUnchanged(
    expected: UserProfileRecord,
    input: CompleteUserProfileInput,
    recordPhoneAudit: RecordPhoneAudit,
  ): Promise<ProfileCompletionOutcome>;
  fillStudentId(
    input: FillStudentIdInput,
    recordPhoneAudit: RecordPhoneAudit,
  ): Promise<StudentIdFillOutcome>;
  updateProfileFields(
    expected: UserProfileRecord,
    fields: UpdateProfileFieldsInput,
    recordStaffNumberAudit: RecordStaffNumberAudit,
    recordPhoneAudit: RecordPhoneAudit,
  ): Promise<void>;
}

export interface FillStudentIdInput {
  readonly expected: UserProfileRecord;
  readonly studentId: string;
  readonly phone?: string;
}

@Injectable()
export class UsersRepository implements UsersRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    recordPhoneAudit: RecordPhoneAudit,
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
          recordPhoneAudit,
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

  fillStudentId(
    input: FillStudentIdInput,
    recordPhoneAudit: RecordPhoneAudit,
  ): Promise<StudentIdFillOutcome> {
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
        recordPhoneAudit,
        input.expected,
        input.phone,
      );
      return outcome;
    });
  }

  async updateProfileFields(
    expected: UserProfileRecord,
    fields: UpdateProfileFieldsInput,
    recordStaffNumberAudit: RecordStaffNumberAudit,
    recordPhoneAudit: RecordPhoneAudit,
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
          recordStaffNumberAudit,
          expected,
          staffNumberBefore ?? null,
          fields.staffNumber,
        );
      }
      await writeUserPhoneIfChanged(
        transaction,
        recordPhoneAudit,
        expected,
        fields.phone,
      );
    });
  }
}

async function writeUserPhoneIfChanged(
  transaction: Prisma.TransactionClient,
  recordPhoneAudit: RecordPhoneAudit,
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
  requireAuditIdentity(
    user,
    'Phone updates require a full user profile record for auditing.',
  );
  await transaction.user.update({
    where: { id: user.id },
    data: { phone },
  });
  await recordPhoneAudit(
    { auditLogWriter: transaction },
    { user, transition: locked.phone === null ? 'set' : 'replaced' },
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
  recordStaffNumberAudit: RecordStaffNumberAudit,
  user: UserProfileRecord,
  before: string | null,
  after: string | null,
): Promise<void> {
  if (before === after) {
    return;
  }
  requireAuditIdentity(
    user,
    'Staff number updates require a full user profile record for auditing.',
  );
  await recordStaffNumberAudit(
    { auditLogWriter: transaction },
    { user, before, after },
  );
}

function requireAuditIdentity(
  user: UserProfileRecord,
  message: string,
): asserts user is AuditableUserProfileRecord {
  if (
    typeof user.githubId !== 'bigint' ||
    typeof user.githubLogin !== 'string'
  ) {
    throw new TypeError(message);
  }
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
