import { Inject, Injectable } from '@nestjs/common';
import type {
  OnboardingRepositoryPort,
  OnboardingTransactionStore,
} from '../domain/onboarding-store';
import type {
  MemberUser,
  StaffAccessRequestRecord,
} from '../domain/member-onboarding';
import { UsersOnboardingRepository } from '../repository/onboarding.repository';

@Injectable()
export class UsersOnboardingService implements OnboardingRepositoryPort {
  constructor(
    @Inject(UsersOnboardingRepository)
    private readonly repository: OnboardingRepositoryPort,
  ) {}

  withTransaction<T>(
    operation: (store: OnboardingTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction(operation);
  }

  findUserByGithubId(githubId: bigint): Promise<MemberUser | null> {
    return this.repository.findUserByGithubId(githubId);
  }

  findLatestRequest(userId: string): Promise<StaffAccessRequestRecord | null> {
    return this.repository.findLatestRequest(userId);
  }
}
