import { ForbiddenException, Injectable } from '@nestjs/common';
import { DeadlineDigestStore } from './deadline-digest.store';

export interface DeadlineDigestFailure {
  readonly id: string;
  readonly createdAt: string;
  readonly error: string | null;
}

@Injectable()
export class DeadlineDigestFailuresService {
  constructor(private readonly repository: DeadlineDigestStore) {}

  async listFailures(githubId: bigint): Promise<DeadlineDigestFailure[]> {
    if (!(await this.repository.findActiveAdmin(githubId))) {
      throw new ForbiddenException('Active administrator access is required');
    }

    const failures = await this.repository.findFailedNotifications();
    return failures.map((failure) => ({
      id: failure.id,
      createdAt: failure.createdAt.toISOString(),
      error: this.errorFromPayload(failure.payload),
    }));
  }

  private errorFromPayload(payload: unknown): string | null {
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
    ) {
      return payload.error;
    }
    return null;
  }
}
