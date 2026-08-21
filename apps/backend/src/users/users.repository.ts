import { Inject, Injectable } from '@nestjs/common';
import { MemberKind, Prisma, Role, RoleRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  fillCompatibleStudentIdIfUnchanged,
  type StudentIdFillOutcome,
} from '../profiles/profile-compatibility.repository';
import {
  COMPATIBLE_PROFILE_SELECT,
  resolveCompatibleProfile,
  type CompleteCompatibleProfile,
} from '../profiles/profile-compatibility';
import { resolveMemberAuthorityCompatibility } from '../profiles/member-authority-compatibility';
import { confirmSelectedRole } from '../roles/role-confirmation';
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
  role: true,
  selectedRole: true,
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  ...COMPATIBLE_PROFILE_SELECT,
  roleRequests: {
    where: { status: RoleRequestStatus.PENDING },
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
  fillStudentId(
    expected: UserProfileRecord,
    profile: CompleteCompatibleProfile,
  ): Promise<StudentIdFillOutcome>;
  updateProfileFields(
    userId: string,
    fields: UpdateProfileFieldsInput,
  ): Promise<void>;
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

  /**
   * 학번·학과가 모두 있으면 UserProfile + 구버전 User 컬럼에 함께 쓴다.
   *
   * nullable expand 뒤에도 이 호환 writer는 학번 없는 UserProfile 행을 아직 만들지 않는다.
   * 학번·학과가 필요 없는 역할(STAFF·ADMIN)은 기존 동작대로 구버전 User 컬럼에만 저장한다.
   * 읽기는 `resolveCompatibleProfile`이 UserProfile 행이 없을 때 User 컬럼으로 떨어지므로
   * 데이터 전환 전 런타임 동작은 그대로다.
   *
   * 학번이 실린 채로 legacy 분기에 오는 일은 없다 — 그 조합(학번 있음 + 학과 없음)은
   * 유일성 제약이 걸리지 않는 User 컬럼에만 학번을 남기게 되므로 서비스가 먼저 400으로
   * 막는다. 여기서도 분기 조건을 학번 기준으로 적어 그 계약을 코드로 남긴다.
   *
   * **여기가 가입이 끝나는 지점이다(#569).** 프로필이 완료되는 이 순간에 고른 역할이
   * 확정된다 — 학생은 `User.role`이 붙고 교직원은 승인 요청이 만들어진다. 확정을 같은
   * 트랜잭션 안에 두는 이유는, 따로 떼면 그 사이에서 끊겼을 때 "프로필은 완료됐는데
   * 역할이 없는" 계정이 남기 때문이다. 그 계정은 프로필 화면이 이미 완료라며 곧바로
   * 내보내므로 `가입 마치기`를 다시 누를 기회를 영영 얻지 못한다.
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
            name: input.name,
            studentId: input.studentId,
            department: input.department,
            selectedRole: memberKindToRole(input.memberKind),
            selectedMemberKind: input.memberKind,
            hasStaffAccess: input.hasStaffAccess,
            hasAdminAccess: input.hasAdminAccess,
          },
        });
        await confirmSelectedRole(transaction, {
          id: expected.id,
          role: current.role,
          selectedRole: memberKindToRole(input.memberKind),
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
   * 완료된 프로필에 학번을 처음 채운다 — UserProfile 행을 만드는 경로 하나로만 간다.
   *
   * `expected`는 직전에 읽은 프로필이다. expand 단계는 nullable이지만 아직 null 학번
   * UserProfile을 쓰지 않으므로, 이 릴리스에서 학번이 비어 있다는 것은 기존처럼 행이 없다는
   * 뜻이다. 그래서 이름·학과는 구버전 User 컬럼 값과 같고 아래 CAS 기준값으로 쓸 수 있다.
   */
  fillStudentId(
    expected: UserProfileRecord,
    profile: CompleteCompatibleProfile,
  ): Promise<StudentIdFillOutcome> {
    return this.prisma.$transaction((transaction) =>
      fillCompatibleStudentIdIfUnchanged(transaction, expected, profile),
    );
  }

  /**
   * 이름·학과만 갱신한다 — 학번은 이 경로로 오지 않는다.
   *
   * UserProfile 행이 없는 사용자(위의 legacy-only 완료)도 있어 update가 아니라
   * updateMany를 쓴다 — 0행이면 조용히 넘어가고 User 컬럼만 갱신한다. 이 "조용히
   * 넘어감"이 학번에는 치명적이라 학번은 `fillStudentId`로 분리했다: 예전에는 여기로
   * 흘러 들어와 UserProfile이 0행 갱신되고 제약 없는 User.studentId에만 남았다.
   */
  async updateProfileFields(
    userId: string,
    fields: UpdateProfileFieldsInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.userProfile.updateMany({
        where: { userId },
        data: fields,
      });
      await transaction.user.update({
        where: { id: userId },
        data: { name: fields.name, department: fields.department },
      });
    });
  }
}

function toUserProfileRecord(user: ProfileMemberRow): UserProfileRecord {
  const profile = resolveCompatibleProfile(user);
  const authority = resolveMemberAuthorityCompatibility(user);
  return {
    id: user.id,
    role: authority.role,
    selectedRole: user.selectedRole,
    selectedMemberKind: authority.selectedMemberKind,
    memberKind: authority.memberKind,
    affiliationKind: authority.affiliationKind,
    affiliationName: authority.affiliationName,
    hasStaffAccess: authority.hasStaffAccess,
    hasAdminAccess: authority.hasAdminAccess,
    hasPendingStaffRequest: user.roleRequests.length > 0,
    ...profile,
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
    current.role === expected.role &&
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

function memberKindToRole(memberKind: MemberKind): Role {
  switch (memberKind) {
    case MemberKind.STUDENT:
      return Role.STUDENT;
    case MemberKind.STAFF:
      return Role.STAFF;
  }
}
