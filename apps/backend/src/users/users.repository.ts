import { Inject, Injectable } from '@nestjs/common';
import { Prisma, RoleRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  completeCompatibleProfileIfUnchanged,
  fillCompatibleStudentIdIfUnchanged,
  type StudentIdFillOutcome,
} from '../profiles/profile-compatibility.repository';
import {
  COMPATIBLE_PROFILE_SELECT,
  resolveCompatibleProfile,
  type CompleteCompatibleProfile,
} from '../profiles/profile-compatibility';
import { confirmSelectedRole } from '../roles/role-confirmation';
import type {
  CompleteUserProfileInput,
  UpdateProfileFieldsInput,
  UserProfileRecord,
} from './domain/user-profile';

export type { StudentIdFillOutcome };

export interface UsersRepositoryPort {
  findByGithubId(githubId: bigint): Promise<UserProfileRecord | null>;
  completeProfileIfUnchanged(
    expected: UserProfileRecord,
    input: CompleteUserProfileInput,
  ): Promise<boolean>;
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
      select: {
        id: true,
        // 완료 판정이 역할에 따라 달라져 함께 읽는다(#439).
        role: true,
        // 확정을 `가입 마치기`로 미룬 뒤(#569) 프로필을 입력하는 동안에는 role도
        // 승인 요청도 없다. 그 구간에서 무엇을 필수로 볼지 아는 근거가 이 값뿐이다.
        selectedRole: true,
        // 승인 대기 중인 교직원은 아직 role이 null이다. 그 사람이 지금 프로필을
        // 채우는 당사자라, 이 표시가 없으면 학생 기준으로 학번을 요구받는다.
        roleRequests: {
          where: { status: RoleRequestStatus.PENDING },
          select: { id: true },
          take: 1,
        },
        ...COMPATIBLE_PROFILE_SELECT,
      },
    });
    return user
      ? {
          id: user.id,
          role: user.role,
          selectedRole: user.selectedRole,
          hasPendingStaffRequest: user.roleRequests.length > 0,
          ...resolveCompatibleProfile(user),
        }
      : null;
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
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const completed = await completeFields(transaction, expected, input);
        if (!completed) {
          return false;
        }
        await confirmSelectedRole(transaction, {
          id: expected.id,
          role: expected.role ?? null,
          selectedRole: expected.selectedRole ?? null,
        });
        return true;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
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
      await transaction.user.update({ where: { id: userId }, data: fields });
    });
  }
}

/**
 * 프로필 값만 쓴다 — 역할 확정은 호출부가 같은 트랜잭션 안에서 이어서 한다.
 *
 * 학번이 실린 저장은 UserProfile 행을 만드는 경로로 가고(유일성 제약이 거기에만 있다),
 * 학번이 없는 저장은 구버전 User 컬럼에만 남긴다. 두 경로 모두 "직전에 읽은 값이
 * 그대로인가"를 CAS로 확인해, 같은 계정의 동시 저장 두 건 중 하나만 통과시킨다.
 */
async function completeFields(
  transaction: Prisma.TransactionClient,
  expected: UserProfileRecord,
  input: CompleteUserProfileInput,
): Promise<boolean> {
  if (input.studentId !== null) {
    return completeCompatibleProfileIfUnchanged(
      transaction,
      expected,
      requireStorableStudentId(input.name, input.studentId, input.department),
    );
  }
  const updated = await transaction.user.updateMany({
    where: {
      id: expected.id,
      name: expected.name,
      studentId: expected.studentId,
      department: expected.department,
    },
    data: input,
  });
  return updated.count === 1;
}

/**
 * 학번이 실린 완료 저장은 학과가 함께 있어야 한다 — 학번이 유일성 제약 아래 놓이는 곳은
 * UserProfile 행뿐이고 그 행은 학과를 요구한다. 서비스가 먼저 400으로 막으므로 여기까지
 * 오면 계약이 깨진 것이다. 조용히 legacy 컬럼에 쓰는 대신 멈춘다 — 그 조용한 쓰기가
 * 서로 다른 두 사람에게 같은 학번을 허용하던 결함이었다.
 */
function requireStorableStudentId(
  name: string,
  studentId: string,
  department: string | null,
): CompleteCompatibleProfile {
  if (department === null) {
    throw new Error(
      '학번을 저장하려면 학과가 필요합니다 — 서비스가 먼저 걸렀어야 합니다.',
    );
  }
  return { name, studentId, department };
}
