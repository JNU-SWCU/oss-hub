import type { MailSender } from './gmail-mail.client';
import type { ProgramMailDeliveryStore } from './program-mail-delivery.repository';
import { ProgramMailDeliveryService } from './program-mail-delivery.service';
import type { ProgramMailSendRepository } from './program-mail-send.repository';
import { ProgramMailTemplateService } from './program-mail-template.service';

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

function eventAt(
  events: ReadonlyMap<number, ReturnType<typeof deferred>>,
  count: number,
): Promise<void> {
  const event = events.get(count);
  if (event === undefined) throw new TypeError(`Missing batch event: ${count}`);
  return event.promise;
}

async function bounded(event: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Program mail batch event timed out')),
      1000,
    );
  });
  try {
    await Promise.race([event, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

it('delivers recipients in sequential batches of ten', async () => {
  const transaction: jest.Mocked<ProgramMailDeliveryStore> = {
    key: jest.fn(
      (previewVersion, userId) => `program-mail:${previewVersion}:${userId}`,
    ),
    claimNotification: jest.fn().mockResolvedValue(true),
    completeNotification: jest.fn().mockResolvedValue(undefined),
  };
  const repository: jest.Mocked<Pick<ProgramMailSendRepository, 'run'>> = {
    run: jest.fn((_input, deliver) => deliver(transaction)),
  };
  const reached = new Map([
    [10, deferred()],
    [20, deferred()],
    [25, deferred()],
  ]);
  const pending: (() => void)[] = [];
  let attempts = 0;
  let active = 0;
  let maxActive = 0;
  const mailSender: MailSender = {
    send: () => {
      attempts += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      reached.get(attempts)?.resolve();
      return new Promise<void>((resolve) => {
        pending.push(() => {
          active -= 1;
          resolve();
        });
      });
    },
  };
  const delivery = new ProgramMailDeliveryService(
    repository,
    mailSender,
    new ProgramMailTemplateService(),
  );
  const sending = delivery.send({
    actorId: 'staff-1',
    programId: 'program-1',
    programName: '합성 프로그램',
    senderName: '합성 교직원',
    subject: '안내',
    body: '본문',
    previewVersion: 'a'.repeat(64),
    occurredAt: new Date('2026-11-18T00:00:00.000Z'),
    recipients: Array.from({ length: 25 }, (_, index) => ({
      id: `student-${index}`,
      displayName: `학생 ${index}`,
      notificationEmail: `student-${index}@example.com`,
    })),
  });

  await bounded(eventAt(reached, 10));
  expect(attempts).toBe(10);
  pending.splice(0).forEach((release) => release());
  await bounded(eventAt(reached, 20));
  expect(attempts).toBe(20);
  pending.splice(0).forEach((release) => release());
  await bounded(eventAt(reached, 25));
  expect(attempts).toBe(25);
  pending.splice(0).forEach((release) => release());

  await expect(sending).resolves.toEqual({
    sentCount: 25,
    duplicateCount: 0,
    failedCount: 0,
  });
  expect(maxActive).toBe(10);
  expect(repository.run.mock.calls).toHaveLength(1);
});
