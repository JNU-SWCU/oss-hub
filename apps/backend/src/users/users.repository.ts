import { SystemErrorCode } from '../platform/system-error-code.error';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MemberKind, type DepartmentType } from './user-contract.config';
import type { UserHistoryTransaction } from './user-history.repository';
import { USER_APPROVAL_SELECT } from './user-history.config';
import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import { PrismaService } from '../platform/prisma.service';
import { DomainException } from '../platform/error-code.error';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.error';
import { UserTransitionRepository } from './user-transition.repository';
import { type UserProfileRecord } from './profile-validation.config';
import { randomUUID } from 'node:crypto';

type StudentIdFillOutcome = 'filled' | 'conflict' | 'taken';
export interface CompleteUserProfileInput {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly phone?: string;
  readonly memberKind: MemberKind;
  readonly departmentType: DepartmentType;
  readonly requestsStaffAccess: boolean;
}

export interface UpdateProfileFieldsInput {
  readonly name: string;
  readonly department: string;
  readonly phone?: string;
  readonly staffNumber?: string | null;
  readonly departmentType?: DepartmentType;
}

export type ProfileCompletionOutcome =
  'completed' | 'conflict' | 'student-id-taken';

type AuditWriterStore = {
  readonly auditLogWriter: UserHistoryTransaction;
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

const PROFILE_MEMBER_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  phone: true,
  staffNumber: true,
  ...USER_AUTHORITY_SELECT,
  ...USER_APPROVAL_SELECT,
} as const satisfies Prisma.UserSelect;
type ProfileMemberRow = Prisma.UserGetPayload<{
  select: typeof PROFILE_MEMBER_SELECT;
}>;

@Injectable()
export class UsersRepository implements UsersRepositoryPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly transitions: UserTransitionRepository,
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
    recordPhoneAudit: RecordPhoneAudit,
  ): Promise<ProfileCompletionOutcome> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.transitions.lock(transaction, expected.id);
        const current = await transaction.user.findUnique({
          where: { id: expected.id },
          select: PROFILE_MEMBER_SELECT,
        });
        if (
          !current ||
          !sameProfileSnapshot(toUserProfileRecord(current), expected)
        )
          return 'conflict';
        const now = new Date();
        await transaction.user.update({
          where: { id: expected.id },
          data: {
            name: input.name,
            studentId: input.studentId,
            department: input.department,
            departmentType: input.departmentType,
            profileCreatedAt: current.profileCreatedAt ?? now,
            profileUpdatedAt: now,
          },
        });
        await writeUserPhoneIfChanged(
          transaction,
          recordPhoneAudit,
          toUserProfileRecord(current),
          input.phone,
        );
        await recordProfileChange(transaction, current, {
          name: input.name,
          studentId: input.studentId,
          department: input.department,
        });
        if (input.requestsStaffAccess)
          await this.transitions.requestStaffAccess(transaction, expected.id);
        return 'completed';
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
      if (input.studentId === null) return 'conflict';
      const owner = await this.prisma.user.findUnique({
        where: { studentId: input.studentId },
        select: { id: true },
      });
      return owner !== null && owner.id !== expected.id
        ? 'student-id-taken'
        : 'conflict';
    }
  }
  async fillStudentId(
    input: FillStudentIdInput,
    recordPhoneAudit: RecordPhoneAudit,
  ): Promise<StudentIdFillOutcome> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.transitions.lock(transaction, input.expected.id);
        const current = await transaction.user.findUniqueOrThrow({
          where: { id: input.expected.id },
          select: PROFILE_MEMBER_SELECT,
        });
        if (
          current.studentId !== null ||
          current.type !== 'STUDENT' ||
          current.type !== (input.expected.memberKind ?? 'UNSELECTED')
        )
          return 'conflict';
        const owner = await transaction.user.findUnique({
          where: { studentId: input.studentId },
          select: { id: true },
        });
        if (owner) return 'taken';
        await transaction.user.update({
          where: { id: current.id },
          data: { studentId: input.studentId, profileUpdatedAt: new Date() },
        });
        await recordProfileChange(transaction, current, {
          studentId: input.studentId,
        });
        await writeUserPhoneIfChanged(
          transaction,
          recordPhoneAudit,
          toUserProfileRecord(current),
          input.phone,
        );
        return 'filled';
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return 'taken';
      throw error;
    }
  }
  async updateProfileFields(
    expected: UserProfileRecord,
    fields: UpdateProfileFieldsInput,
    recordStaffNumberAudit: RecordStaffNumberAudit,
    recordPhoneAudit: RecordPhoneAudit,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.transitions.lock(transaction, expected.id);
      const current = await transaction.user.findUniqueOrThrow({
        where: { id: expected.id },
        select: PROFILE_MEMBER_SELECT,
      });
      if (fields.staffNumber !== undefined && current.type !== 'STAFF') {
        throw new DomainException({
          code: SystemErrorCode.VALIDATION_FAILED,
          status: 400,
          message: '교직원 번호는 교직원만 수정할 수 있습니다.',
        });
      }
      if (current.type !== (expected.memberKind ?? 'UNSELECTED'))
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.PROFILE_UPDATE_CONFLICT],
        );
      const profileChanged =
        fields.name !== current.name ||
        fields.department !== current.department ||
        (fields.departmentType !== undefined &&
          fields.departmentType !== current.departmentType) ||
        (fields.staffNumber !== undefined &&
          fields.staffNumber !== current.staffNumber);
      if (profileChanged) {
        await transaction.user.update({
          where: { id: expected.id },
          data: {
            name: fields.name,
            department: fields.department,
            ...(fields.departmentType === undefined
              ? {}
              : { departmentType: fields.departmentType }),
            ...(fields.staffNumber === undefined
              ? {}
              : { staffNumber: fields.staffNumber }),
            profileUpdatedAt: new Date(),
          },
        });
      }
      await recordProfileChange(transaction, current, {
        name: fields.name,
        department: fields.department,
      });
      if (
        fields.staffNumber !== undefined &&
        fields.staffNumber !== current.staffNumber
      ) {
        await recordStaffNumberAudit(
          { auditLogWriter: transaction },
          {
            user: auditable(toUserProfileRecord(current)),
            before: current.staffNumber,
            after: fields.staffNumber,
          },
        );
      }
      await writeUserPhoneIfChanged(
        transaction,
        recordPhoneAudit,
        toUserProfileRecord(current),
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
  if (phone === undefined || phone === user.phone) return;
  await transaction.user.update({ where: { id: user.id }, data: { phone } });
  await recordPhoneAudit(
    { auditLogWriter: transaction },
    {
      user: auditable(user),
      transition: user.phone == null ? 'set' : 'replaced',
    },
  );
}
function auditable(user: UserProfileRecord): AuditableUserProfileRecord {
  if (user.githubId === undefined || user.githubLogin === undefined)
    throw new TypeError('Profile audit requires account identity');
  return { ...user, githubId: user.githubId, githubLogin: user.githubLogin };
}
async function recordProfileChange(
  transaction: Prisma.TransactionClient,
  before: ProfileMemberRow,
  after: {
    readonly name?: string;
    readonly studentId?: string | null;
    readonly department?: string;
  },
): Promise<void> {
  const changes = (['name', 'studentId', 'department'] as const).flatMap(
    (field) =>
      after[field] !== undefined && after[field] !== before[field]
        ? [{ field, before: before[field], after: after[field] }]
        : [],
  );
  if (changes.length === 0) return;
  const person = { displayName: before.name, githubLogin: before.nickname };
  await transaction.userHistory.create({
    data: {
      id: 'user:' + randomUUID(),
      userId: before.id,
      actorId: before.id,
      event: 'PROFILE_UPDATED',
      source: 'APPLICATION',
      data: {
        schemaVersion: 1,
        recordKind: 'DOMAIN_EVENT',
        action: 'USER_PROFILE_UPDATED',
        targetType: 'USER',
        targetId: before.id,
        metadata: { schemaVersion: 1, actor: person, target: person, changes },
        request: null,
      },
    },
  });
}
function toUserProfileRecord(user: ProfileMemberRow): UserProfileRecord {
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: user.name,
    studentId: user.studentId,
    department: user.department,
    phone: user.phone,
    staffNumber: user.staffNumber,
    memberKind: user.type === 'UNSELECTED' ? null : user.type,
    selectedMemberKind: user.type === 'UNSELECTED' ? null : user.type,
    departmentType: user.departmentType,
    hasAdminAccess: user.admin !== null,
    hasPendingStaffRequest:
      user.approvalStatus === 'PENDING' && user.approvalRequestId !== null,
    profileCreatedAt: user.profileCreatedAt,
    approvalStatus: user.approvalStatus,
    approvalRequestId: user.approvalRequestId,
  };
}
function sameProfileSnapshot(
  current: UserProfileRecord,
  expected: UserProfileRecord,
): boolean {
  return (
    current.profileCreatedAt?.getTime() ===
      expected.profileCreatedAt?.getTime() &&
    (
      [
        'name',
        'studentId',
        'department',
        'phone',
        'staffNumber',
        'memberKind',
        'selectedMemberKind',
        'departmentType',
        'approvalStatus',
        'approvalRequestId',
      ] as const
    ).every((key) => current[key] === expected[key])
  );
}
