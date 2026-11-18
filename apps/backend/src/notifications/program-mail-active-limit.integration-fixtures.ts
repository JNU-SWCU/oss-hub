import { ProgramMailAuditRepository } from './program-mail-audit.repository';
import { ProgramMailDeliveryRepository } from './program-mail-delivery.repository';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import { ProgramMailSendRepository } from './program-mail-send.repository';
import type { ProgramMailIntegrationWorld } from './program-mail.integration-support';

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function bounded(event: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Program mail active-limit event timed out')),
      5000,
    );
  });
  try {
    await Promise.race([event, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function registerProgramMailActiveLimitCase(
  currentWorld: () => ProgramMailIntegrationWorld,
): void {
  it('shares the two-send active limit across repository instances', async () => {
    const world = currentWorld();
    const entered = deferred();
    const release = deferred();
    let active = 0;
    const run = (index: number, actorId: string) =>
      new ProgramMailSendRepository(
        world.prisma,
        new ProgramMailAuditRepository(),
        new ProgramMailDeliveryRepository(world.prisma),
      ).run(
        {
          actorId,
          programId: `active-program-${index}`,
          programName: `Active program ${index}`,
          recipientIds: [],
          subject: `Active subject ${index}`,
          bodyHash: 'a'.repeat(64),
          bodyLength: 1,
          previewVersion: `active-preview-${index}`,
          occurredAt: new Date(),
        },
        async () => {
          active += 1;
          if (active === 2) entered.resolve();
          await release.promise;
          return { sentCount: 0, duplicateCount: 0, failedCount: 0 };
        },
      );
    const first = run(1, 'test:notifications:staff-on');
    const second = run(2, 'test:notifications:staff-off');
    await bounded(entered.promise);

    await expect(run(3, 'test:notifications:admin-on')).rejects.toMatchObject({
      errorCode:
        NOTIFICATIONS_ERROR_CODES[
          NotificationsErrorCode.PROGRAM_MAIL_RATE_LIMITED
        ],
    });
    release.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { sentCount: 0, duplicateCount: 0, failedCount: 0 },
      { sentCount: 0, duplicateCount: 0, failedCount: 0 },
    ]);
  });
}
