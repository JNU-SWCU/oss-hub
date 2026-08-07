import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import type { DeadlineDigestRepositoryPort } from './deadline-digest.repository';
import { DeadlineDigestService } from './deadline-digest.service';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.enum';

@Injectable()
export class DeadlineDigestTriggerService {
  constructor(
    @Inject(DeadlineDigestRepository)
    private readonly repository: Pick<
      DeadlineDigestRepositoryPort,
      'findActiveStaffOrAdmin'
    >,
    @Inject(DeadlineDigestService)
    private readonly digestService: Pick<
      DeadlineDigestService,
      'sendDeadlineDigests'
    >,
  ) {}

  async triggerSend(githubId: bigint, now: Date = new Date()): Promise<void> {
    if (!(await this.repository.findActiveStaffOrAdmin(githubId))) {
      throw new DomainException(
        NOTIFICATIONS_ERROR_CODES[NotificationsErrorCode.STAFF_ONLY],
      );
    }
    await this.digestService.sendDeadlineDigests(now);
  }
}
