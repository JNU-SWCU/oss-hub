import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
        ...COMPATIBLE_PROFILE_SELECT,
      },
    });
    return user
      ? { id: user.id, role: user.role, ...resolveCompatibleProfile(user) }
      : null;
  }

  /**
   * 학번·학과가 모두 있으면 UserProfile + 구버전 User 컬럼에 함께 쓴다.
   *
   * 하나라도 null이면 UserProfile 행을 만들 수 없다 — 그 테이블의 studentId·
   * department가 NOT NULL이라서다. 학번·학과가 필요 없는 역할(STAFF·ADMIN)은
   * 그래서 구버전 User 컬럼에만 저장한다. 읽기는 `resolveCompatibleProfile`이
   * UserProfile 행이 없을 때 User 컬럼으로 떨어지므로 그대로 동작한다.
   * (UserProfile.studentId를 nullable로 바꾸는 스키마 변경은 별도 승인 사항.)
   *
   * 학번이 실린 채로 legacy 분기에 오는 일은 없다 — 그 조합(학번 있음 + 학과 없음)은
   * 유일성 제약이 걸리지 않는 User 컬럼에만 학번을 남기게 되므로 서비스가 먼저 400으로
   * 막는다. 여기서도 분기 조건을 학번 기준으로 적어 그 계약을 코드로 남긴다.
   */
  async completeProfileIfUnchanged(
    expected: UserProfileRecord,
    input: CompleteUserProfileInput,
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        if (input.studentId !== null) {
          return completeCompatibleProfileIfUnchanged(
            transaction,
            expected,
            requireStorableStudentId(
              input.name,
              input.studentId,
              input.department,
            ),
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
   * `expected`는 직전에 읽은 프로필이고, 학번이 비어 있다는 것은 곧 UserProfile 행이
   * 없다는 뜻이다(그 테이블의 studentId는 NOT NULL이라 비어 있을 수 없다). 그래서
   * `expected`의 이름·학과는 구버전 User 컬럼 값과 같고, 아래 CAS의 기준값으로 쓸 수 있다.
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
