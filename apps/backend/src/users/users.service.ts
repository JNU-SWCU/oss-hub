import { Inject, Injectable } from '@nestjs/common';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import { ConsentsService } from '../consents/consents.service';
import type {
  CompleteUserProfileInput,
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

  async completeMyProfile(
    githubId: bigint,
    input: CompleteUserProfileInput,
  ): Promise<UserProfile> {
    await this.consentsService.requireCurrent(githubId);
    const user = await this.requireUser(githubId);
    if (toUserProfile(user).isComplete) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_ALREADY_COMPLETE],
      );
    }

    const completed = await this.repository.completeProfileIfUnchanged(
      user,
      input,
    );
    if (!completed) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_ALREADY_COMPLETE],
      );
    }

    return {
      ...input,
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
