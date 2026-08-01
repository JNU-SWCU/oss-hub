import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { completeCompatibleProfileIfUnchanged } from '../profiles/profile-compatibility.repository';
import {
  COMPATIBLE_PROFILE_SELECT,
  resolveCompatibleProfile,
} from '../profiles/profile-compatibility';
import type {
  CompleteUserProfileInput,
  UpdateProfileFieldsInput,
  UserProfileRecord,
} from './domain/user-profile';

export interface UsersRepositoryPort {
  findByGithubId(githubId: bigint): Promise<UserProfileRecord | null>;
  completeProfileIfUnchanged(
    expected: UserProfileRecord,
    input: CompleteUserProfileInput,
  ): Promise<boolean>;
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
   */
  async completeProfileIfUnchanged(
    expected: UserProfileRecord,
    input: CompleteUserProfileInput,
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        if (input.studentId !== null && input.department !== null) {
          return completeCompatibleProfileIfUnchanged(transaction, expected, {
            name: input.name,
            studentId: input.studentId,
            department: input.department,
          });
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
   * UserProfile 행이 없는 사용자(위의 legacy-only 완료)도 있어 update가 아니라
   * updateMany를 쓴다 — 0행이면 조용히 넘어가고 User 컬럼만 갱신한다.
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
