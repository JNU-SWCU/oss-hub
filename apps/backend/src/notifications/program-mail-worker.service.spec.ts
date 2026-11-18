import type { ProgramMailBatchRepository } from './program-mail-batch.repository';
import {
  PROGRAM_MAIL_BATCH_DEADLINE_MS,
  PROGRAM_MAIL_LEASE_MS,
  PROGRAM_MAIL_LEASE_SAFETY_MARGIN_MS,
} from './program-mail.config';
import type { ProgramMailDeliveryRepository } from './program-mail-delivery.repository';
import type {
  ProgramMailBatchWork,
  ProgramMailDeliveryResult,
} from './program-mail-send.types';
import { ProgramMailTemplateService } from './program-mail-template.service';
import { ProgramMailTransportService } from './program-mail-transport.service';
import { ProgramMailWorkerService } from './program-mail-worker.service';

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
    timer = setTimeout(() => reject(new Error('Worker event timed out')), 5000);
  });
  try {
    await Promise.race([event, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const now = new Date('2026-11-18T00:00:00.000Z');
const result: ProgramMailDeliveryResult = {
  sentCount: 11,
  duplicateCount: 0,
  failedCount: 0,
  unknownCount: 0,
};
const work: ProgramMailBatchWork = {
  actorId: 'staff-1',
  programId: 'program-1',
  programName: '프로그램',
  senderName: '운영자',
  subject: '제목',
  body: '본문',
  bodyHash: 'a'.repeat(64),
  bodyLength: 2,
  previewVersion: 'preview-1',
  occurredAt: now,
  recipients: Array.from({ length: 11 }, (_, index) => ({
    id: `user-${index}`,
    displayName: `지원자 ${index}`,
    notificationEmail: `user-${index}@example.com`,
  })),
  batchKey: 'program-mail-send:preview-1',
  workerId: 'worker-1',
  leaseToken: 'lease-1',
  leaseExpiresAt: new Date(now.getTime() + 300_000),
  deliveryAllowed: true,
};

describe('ProgramMailWorkerService', () => {
  afterEach(() => jest.useRealTimers());

  it('renews between bounded recipient batches and sends at most ten at once', async () => {
    const entered = deferred();
    const release = deferred();
    let attempts = 0;
    let active = 0;
    let maximumActive = 0;
    const batches: Pick<
      ProgramMailBatchRepository,
      'claim' | 'renew' | 'complete' | 'findRecoverableBatchKeys'
    > = {
      claim: jest.fn().mockResolvedValue(work),
      renew: jest.fn().mockImplementation(() => Promise.resolve({ ...work })),
      complete: jest.fn().mockResolvedValue({
        kind: 'COMPLETED',
        batchKey: work.batchKey,
        result,
      }),
      findRecoverableBatchKeys: jest.fn().mockResolvedValue([]),
    };
    const deliveries: Pick<
      ProgramMailDeliveryRepository,
      | 'states'
      | 'claim'
      | 'complete'
      | 'markUnknown'
      | 'markClaimedUnknown'
      | 'result'
    > = {
      states: jest.fn().mockResolvedValue(
        work.recipients.map((recipient) => ({
          key: `key-${recipient.id}`,
          recipient,
          status: 'PENDING',
          code: null,
          leaseExpiresAt: null,
        })),
      ),
      claim: jest.fn().mockResolvedValue(true),
      complete: jest.fn().mockResolvedValue(true),
      markUnknown: jest.fn().mockResolvedValue(true),
      markClaimedUnknown: jest.fn().mockResolvedValue(true),
      result: jest.fn().mockResolvedValue(result),
    };
    const transport: Pick<ProgramMailTransportService, 'send' | 'runBatch'> = {
      runBatch: <Result>(operation: (signal: AbortSignal) => Promise<Result>) =>
        operation(new AbortController().signal),
      send: jest.fn().mockImplementation(async () => {
        attempts += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (attempts === 10) entered.resolve();
        if (attempts <= 10) await release.promise;
        active -= 1;
      }),
    };
    const worker = new ProgramMailWorkerService(batches, deliveries, transport);

    const processing = worker.process(work.batchKey, () => now);
    await bounded(entered.promise);
    expect(attempts).toBe(10);
    expect(maximumActive).toBe(10);
    release.resolve();
    await expect(processing).resolves.toMatchObject({ kind: 'COMPLETED' });
    expect(attempts).toBe(11);
    expect(maximumActive).toBe(10);
    expect(batches.renew).toHaveBeenCalledTimes(2);
  });

  it('aborts a never-ending batch at the hard deadline and leaves no live operation', async () => {
    expect(
      PROGRAM_MAIL_BATCH_DEADLINE_MS + PROGRAM_MAIL_LEASE_SAFETY_MARGIN_MS,
    ).toBeLessThan(PROGRAM_MAIL_LEASE_MS);
    jest.useFakeTimers();
    jest.setSystemTime(now);
    const entered = deferred();
    const deadlineWork = { ...work, recipients: work.recipients.slice(0, 10) };
    const unknownResult: ProgramMailDeliveryResult = {
      sentCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      unknownCount: 10,
    };
    let attempts = 0;
    let aborted = 0;
    let active = 0;
    const batches: Pick<
      ProgramMailBatchRepository,
      'claim' | 'renew' | 'complete' | 'findRecoverableBatchKeys'
    > = {
      claim: jest.fn().mockResolvedValue(deadlineWork),
      renew: jest.fn().mockResolvedValue(deadlineWork),
      complete: jest.fn().mockResolvedValue({
        kind: 'COMPLETED',
        batchKey: work.batchKey,
        result: unknownResult,
      }),
      findRecoverableBatchKeys: jest.fn().mockResolvedValue([]),
    };
    const deliveries: Pick<
      ProgramMailDeliveryRepository,
      | 'states'
      | 'claim'
      | 'complete'
      | 'markUnknown'
      | 'markClaimedUnknown'
      | 'result'
    > = {
      states: jest.fn().mockResolvedValue(
        deadlineWork.recipients.map((recipient) => ({
          key: `key-${recipient.id}`,
          recipient,
          status: 'PENDING',
          code: null,
          leaseExpiresAt: null,
        })),
      ),
      claim: jest.fn().mockResolvedValue(true),
      complete: jest.fn().mockResolvedValue(true),
      markUnknown: jest.fn().mockResolvedValue(true),
      markClaimedUnknown: jest.fn().mockResolvedValue(true),
      result: jest.fn().mockResolvedValue(unknownResult),
    };
    const transport = new ProgramMailTransportService(
      {
        send: (_mail, signal) =>
          new Promise<void>((_resolve, reject) => {
            attempts += 1;
            active += 1;
            if (attempts === 10) entered.resolve();
            signal?.addEventListener(
              'abort',
              () => {
                aborted += 1;
                active -= 1;
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error('Program mail batch aborted'),
                );
              },
              { once: true },
            );
          }),
      },
      new ProgramMailTemplateService(),
    );
    const worker = new ProgramMailWorkerService(batches, deliveries, transport);

    const processing = worker.process(work.batchKey, () => new Date());
    await entered.promise;
    expect(active).toBe(10);
    await jest.advanceTimersByTimeAsync(PROGRAM_MAIL_BATCH_DEADLINE_MS);
    await expect(processing).resolves.toMatchObject({
      kind: 'COMPLETED',
      result: { unknownCount: 10 },
    });
    expect(aborted).toBe(10);
    expect(active).toBe(0);
    expect(deliveries.markClaimedUnknown).toHaveBeenCalledTimes(10);
    expect(deliveries.complete).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
