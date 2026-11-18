import type { ProgramMailBatchRepository } from './program-mail-batch.repository';
import type { ProgramMailDeliveryRepository } from './program-mail-delivery.repository';
import type {
  ProgramMailBatchWork,
  ProgramMailDeliveryResult,
} from './program-mail-send.types';
import type { ProgramMailTransportService } from './program-mail-transport.service';
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
      'states' | 'claim' | 'complete' | 'markUnknown' | 'result'
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
      result: jest.fn().mockResolvedValue(result),
    };
    const transport: Pick<ProgramMailTransportService, 'send'> = {
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
});
