import { DomainException } from '../platform/error-code.error';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import { ProgramMailRateLimitService } from './program-mail-rate-limit.service';

const now = new Date('2026-11-18T00:00:00.000Z');

function complete(
  service: ProgramMailRateLimitService,
  input: {
    readonly actorId: string;
    readonly programId: string;
    readonly idempotencyKey: string;
  },
): void {
  service.begin({ ...input, now })();
}

function expectRateLimited(action: () => void): void {
  try {
    action();
  } catch (error: unknown) {
    if (!(error instanceof DomainException)) throw error;
    expect(error.errorCode).toEqual(
      NOTIFICATIONS_ERROR_CODES[
        NotificationsErrorCode.PROGRAM_MAIL_RATE_LIMITED
      ],
    );
    return;
  }
  throw new Error('Expected program mail rate limit');
}

it('limits fresh sends per staff while allowing an idempotent retry', () => {
  const service = new ProgramMailRateLimitService();
  for (const idempotencyKey of ['preview-1', 'preview-2', 'preview-3']) {
    complete(service, {
      actorId: 'staff-1',
      programId: `program-${idempotencyKey}`,
      idempotencyKey,
    });
  }
  complete(service, {
    actorId: 'staff-1',
    programId: 'program-preview-3',
    idempotencyKey: 'preview-3',
  });

  expectRateLimited(() => {
    service.begin({
      actorId: 'staff-1',
      programId: 'program-4',
      idempotencyKey: 'preview-4',
      now,
    });
  });
});

it('limits fresh sends to the same program across staff accounts', () => {
  const service = new ProgramMailRateLimitService();
  for (let index = 0; index < 5; index += 1) {
    complete(service, {
      actorId: `staff-${index}`,
      programId: 'program-1',
      idempotencyKey: `preview-${index}`,
    });
  }

  expectRateLimited(() => {
    service.begin({
      actorId: 'staff-6',
      programId: 'program-1',
      idempotencyKey: 'preview-6',
      now,
    });
  });
});
