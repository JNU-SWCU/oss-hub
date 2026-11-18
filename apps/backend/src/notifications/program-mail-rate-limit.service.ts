import { Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import {
  PROGRAM_MAIL_ACTIVE_SEND_LIMIT,
  PROGRAM_MAIL_PROGRAM_SEND_LIMIT,
  PROGRAM_MAIL_RATE_WINDOW_MS,
  PROGRAM_MAIL_STAFF_SEND_LIMIT,
} from './program-mail.config';

type SendAttempt = {
  readonly actorId: string;
  readonly programId: string;
  readonly idempotencyKey: string;
  readonly at: number;
};

@Injectable()
export class ProgramMailRateLimitService {
  private active = 0;
  private attempts: SendAttempt[] = [];

  begin(input: {
    readonly actorId: string;
    readonly programId: string;
    readonly idempotencyKey: string;
    readonly now: Date;
  }): () => void {
    const threshold = input.now.getTime() - PROGRAM_MAIL_RATE_WINDOW_MS;
    this.attempts = this.attempts.filter((attempt) => attempt.at > threshold);
    const repeated = this.attempts.some(
      (attempt) => attempt.idempotencyKey === input.idempotencyKey,
    );
    if (
      this.active >= PROGRAM_MAIL_ACTIVE_SEND_LIMIT ||
      (!repeated &&
        (this.attempts.filter((attempt) => attempt.actorId === input.actorId)
          .length >= PROGRAM_MAIL_STAFF_SEND_LIMIT ||
          this.attempts.filter(
            (attempt) => attempt.programId === input.programId,
          ).length >= PROGRAM_MAIL_PROGRAM_SEND_LIMIT))
    ) {
      throw new DomainException(
        NOTIFICATIONS_ERROR_CODES[
          NotificationsErrorCode.PROGRAM_MAIL_RATE_LIMITED
        ],
      );
    }
    if (!repeated) {
      this.attempts.push({
        actorId: input.actorId,
        programId: input.programId,
        idempotencyKey: input.idempotencyKey,
        at: input.now.getTime(),
      });
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}
