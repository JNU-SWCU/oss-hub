import { ForbiddenException, Injectable } from '@nestjs/common';
import { DEADLINE_DIGEST_DELIVERY_FAILURE } from './deadline-digest-failure';
import { DeadlineDigestRepository } from './deadline-digest.repository';

export interface DeadlineDigestFailure {
  readonly id: string;
  readonly createdAt: string;
  readonly code: typeof DEADLINE_DIGEST_DELIVERY_FAILURE.code;
  readonly message: typeof DEADLINE_DIGEST_DELIVERY_FAILURE.message;
}

@Injectable()
export class DeadlineDigestFailuresService {
  constructor(private readonly repository: DeadlineDigestRepository) {}

  async listFailures(githubId: bigint): Promise<DeadlineDigestFailure[]> {
    if (!(await this.repository.findActiveAdmin(githubId))) {
      throw new ForbiddenException('Active administrator access is required');
    }

    const failures = await this.repository.findFailedNotifications();
    return failures.map((failure) => ({
      id: failure.id,
      createdAt: failure.createdAt.toISOString(),
      ...DEADLINE_DIGEST_DELIVERY_FAILURE,
    }));
  }
}
