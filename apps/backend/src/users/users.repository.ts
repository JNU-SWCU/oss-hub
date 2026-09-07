import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  fillStudentIdIfEmpty,
  type StudentIdFillOutcome,
} from '../profiles/user-profile-write.repository';
import { requestStaffAccess } from '../roles/staff-access-request';
import type {
  CompleteUserProfileInput,
  UpdateProfileFieldsInput,
  UserProfileRecord,
} from './domain/user-profile';
import {
  requireUserPhoneAuditRecord,
  writeUserPhoneIfChanged,
} from './user-phone-write';
import {
  PROFILE_MEMBER_SELECT,
  sameProfileSnapshot,
  toUserProfileRecord,
} from './users.repository.profile-read';

export type { StudentIdFillOutcome };
export type ProfileCompletionOutcome =
  'completed' | 'conflict' | 'student-id-taken';

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
    private readonly auditLog?: Pick<AuditLogService, 'record'>,
  ) {}

  async findByGithubId(githubId: bigint): Promise<UserProfileRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: PROFILE_MEMBER_SELECT,
    });
    return user ? toUserProfileRecord(user) : null;
  }

  /**
   * **여기가 가입이 끝나는 지점이다(#569).** 프로필 행이 만들어지는 이 순간에 고른
   * 회원 유형이 확정되고, 교직원은 승인 대기 요청이 함께 만들어진다.
   *
   * 확정을 같은 트랜잭션 안에 두는 이유는, 따로 떼면 그 사이에서 끊겼을 때 "프로필은
   * 완료됐는데 접근 요청이 없는" 계정이 남기 때문이다. 그 계정은 프로필 화면이 이미
   * 완료라며 곧바로 내보내므로 `가입 마치기`를 다시 누를 기회를 영영 얻지 못한다.
   */
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
        if (input.phone !== undefined) {
          await writeUserPhoneIfChanged({
            transaction,
            auditLog: this.auditLog,
            user: requireUserPhoneAuditRecord(expected),
            phone: input.phone,
          });
        }
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

  /**
   * 완료된 프로필에 학번을 처음 채운다.
   *
   * 학번 유일성을 보증하는 것은 `UserProfile.studentId`의 unique 제약뿐이므로
   * 학번이 실리는 쓰기는 예외 없이 이 경로를 지난다 — 이름·학과 갱신과 섞으면
   * 0행 갱신이 조용히 넘어가 학번이 사라진다.
   */
  fillStudentId(input: FillStudentIdInput): Promise<StudentIdFillOutcome>;
  fillStudentId(
    expected: UserProfileRecord,
    studentId: string,
  ): Promise<StudentIdFillOutcome>;
  fillStudentId(
    inputOrExpected: FillStudentIdInput | UserProfileRecord,
    studentId?: string,
  ): Promise<StudentIdFillOutcome> {
    const input = toFillStudentIdInput(inputOrExpected, studentId);
    return this.prisma.$transaction(async (transaction) => {
      const outcome = await fillStudentIdIfEmpty(
        transaction,
        input.expected.id,
        input.studentId,
      );
      if (outcome !== 'filled') {
        return outcome;
      }
      if (input.phone !== undefined) {
        await writeUserPhoneIfChanged({
          transaction,
          auditLog: this.auditLog,
          user: requireUserPhoneAuditRecord(input.expected),
          phone: input.phone,
        });
      }
      return outcome;
    });
  }

  /** 이름·소속만 갱신한다 — 학번은 이 경로로 오지 않는다(`fillStudentId`). */
  async updateProfileFields(
    expected: UserProfileRecord,
    fields: UpdateProfileFieldsInput,
  ): Promise<void>;
  async updateProfileFields(
    userId: string,
    fields: UpdateProfileFieldsInput,
  ): Promise<void>;
  async updateProfileFields(
    expectedOrUserId: UserProfileRecord | string,
    fields: UpdateProfileFieldsInput,
  ): Promise<void> {
    if (typeof expectedOrUserId === 'string' && fields.phone !== undefined) {
      throw new TypeError(
        'Phone updates require a full user profile record for auditing.',
      );
    }
    const expected =
      typeof expectedOrUserId === 'string'
        ? {
            id: expectedOrUserId,
            name: null,
            studentId: null,
            department: null,
            phone: null,
          }
        : expectedOrUserId;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.userProfile.update({
        where: { userId: expected.id },
        data: {
          name: fields.name,
          department: fields.department,
          affiliationName: fields.affiliationName ?? fields.department,
          ...(fields.affiliationKind === undefined
            ? {}
            : { affiliationKind: fields.affiliationKind }),
        },
      });
      if (fields.phone !== undefined) {
        await writeUserPhoneIfChanged({
          transaction,
          auditLog: this.auditLog,
          user: requireUserPhoneAuditRecord(expected),
          phone: fields.phone,
        });
      }
    });
  }
}

function toFillStudentIdInput(
  inputOrExpected: FillStudentIdInput | UserProfileRecord,
  studentId: string | undefined,
): FillStudentIdInput {
  if ('expected' in inputOrExpected) {
    return inputOrExpected;
  }
  if (studentId !== undefined) {
    return { expected: inputOrExpected, studentId };
  }
  throw new TypeError('studentId is required.');
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
