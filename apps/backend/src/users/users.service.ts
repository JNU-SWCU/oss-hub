import { Inject, Injectable } from '@nestjs/common';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import { ConsentsService } from '../consents/consents.service';
import type {
  PatchUserProfileInput,
  UserProfile,
  UserProfileRecord,
} from './domain/user-profile';
import { toUserProfile } from './domain/user-profile';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';
import { UsersRepository } from './users.repository';
import type { UsersRepositoryPort } from './users.repository';

@Injectable()
export class UsersService {
  constructor(
    @Inject(UsersRepository)
    private readonly repository: UsersRepositoryPort,
    @Inject(ConsentsService)
    private readonly consentsService: Pick<ConsentsService, 'requireCurrent'>,
  ) {}

  async getMyProfile(githubId: bigint): Promise<UserProfile> {
    await this.consentsService.requireCurrent(githubId);
    return toUserProfile(await this.requireUser(githubId));
  }

  async requireCompleteProfile(githubId: bigint): Promise<void> {
    const profile = toUserProfile(await this.requireUser(githubId));
    if (!profile.isComplete) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_INCOMPLETE],
      );
    }
  }

  /**
   * 미완료: studentId 필수 → 1회 완료 저장.
   * 완료: name·department만 갱신. studentId가 본문에 있으면 USR_003.
   */
  async patchMyProfile(
    githubId: bigint,
    input: PatchUserProfileInput,
  ): Promise<UserProfile> {
    await this.consentsService.requireCurrent(githubId);
    const user = await this.requireUser(githubId);
    if (!toUserProfile(user).isComplete) {
      if (input.studentId === undefined) {
        throw new DomainException({
          code: SystemErrorCode.VALIDATION_FAILED,
          status: 400,
          message: '온보딩 프로필 완료에는 학번이 필요합니다.',
        });
      }
      const completed = await this.repository.completeProfileIfUnchanged(user, {
        name: input.name,
        studentId: input.studentId,
        department: input.department,
      });
      if (!completed) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.PROFILE_ALREADY_COMPLETE],
        );
      }
      return {
        name: input.name,
        studentId: input.studentId,
        department: input.department,
        isComplete: true,
      };
    }

    if (input.studentId !== undefined) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_IMMUTABLE],
      );
    }

    await this.repository.updateProfileFields(user.id, {
      name: input.name,
      department: input.department,
    });
    return {
      name: input.name,
      studentId: user.studentId,
      department: input.department,
      isComplete: true,
    };
  }

  private async requireUser(githubId: bigint): Promise<UserProfileRecord> {
    const user = await this.repository.findByGithubId(githubId);
    if (!user) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    return user;
  }
}
