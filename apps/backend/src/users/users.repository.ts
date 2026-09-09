import { Inject, Injectable } from '@nestjs/common';
import { Prisma, StaffAccessRequestStatus } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  fillStudentIdIfEmpty,
  type StudentIdFillOutcome,
} from '../profiles/user-profile-write.repository';
import { requestStaffAccess } from '../roles/staff-access-request';
import {
  USER_PHONE_AUDIT_TRANSITIONS,
  USER_PROFILE_AUDIT_ACTIONS,
  createUserPhoneAuditMetadata,
} from '../audit-log/audit-log-metadata';
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
    // 전화번호는 감사 기록과 같은 트랜잭션에서만 바뀌므로 이 의존은 선택이 아니다.
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

  /**
   * 완료된 프로필에 학번을 처음 채운다.
   *
   * 학번 유일성을 보증하는 것은 `UserProfile.studentId`의 unique 제약뿐이므로
   * 학번이 실리는 쓰기는 예외 없이 이 경로를 지난다 — 이름·학과 갱신과 섞으면
   * 0행 갱신이 조용히 넘어가 학번이 사라진다.
   */
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

  /** 이름·소속만 갱신한다 — 학번은 이 경로로 오지 않는다(`fillStudentId`). */
  async updateProfileFields(
    expected: UserProfileRecord,
    fields: UpdateProfileFieldsInput,
  ): Promise<void> {
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
      await writeUserPhoneIfChanged(
        transaction,
        this.auditLog,
        expected,
        fields.phone,
      );
    });
  }
}

/**
 * 전화번호가 바뀜 때만 값과 감사 기록을 같은 트랜잭션에 함께 남긴다.
 *
 * 전이(`SET`·`REPLACED`)의 근거는 호출자 스냅샷이 아니라 이 트랜잭션이 잠근 현재
 * 값이다. 같은 사용자를 동시에 갱신하면 두 요청이 트랜잭션 밖에서 읽은 같은
 * 전화번호를 들고 들어온다 — 뒤에 잠금을 얻은 쪽이 그 스냅샷으로 판정하면 실제로는
 * 교체였는데 `SET`으로 적힌다. 감사 원장은 append-only라 잘못 적힌 전이를 나중에
 * 고칠 수단이 없다(`apps/backend/src/audit-log/AGENTS.md`).
 */
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
