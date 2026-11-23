import { PROGRAM_MAIL_BATCH_DRAIN_MS } from './program-mail.config';
import { ProgramMailTemplateService } from './program-mail-template.service';
import { ProgramMailTransportService } from './program-mail-transport.service.fixture';

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
} {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const work = {
  actorId: 'staff-1',
  programId: 'program-1',
  programName: '프로그램',
  senderName: '운영자',
  subject: '제목',
  body: '본문',
  bodyHash: 'a'.repeat(64),
  bodyLength: 2,
  previewVersion: 'preview-1',
  occurredAt: new Date('2026-11-18T00:00:00.000Z'),
  recipients: [],
  batchKey: 'program-mail-send:preview-1',
  workerId: 'worker-1',
  leaseToken: 'lease-1',
  leaseExpiresAt: new Date('2026-11-18T00:05:00.000Z'),
  deliveryAllowed: true,
} as const;
const state = {
  key: 'program-mail:preview-1:user-1',
  recipient: {
    id: 'user-1',
    displayName: '지원자',
    notificationEmail: 'user-1@example.com',
  },
  status: 'PENDING',
  code: null,
  leaseExpiresAt: null,
} as const;

describe('ProgramMailTransportService', () => {
  afterEach(() => jest.useRealTimers());

  it('aborts and bounded-drains sibling sends after one task rejects', async () => {
    jest.useFakeTimers();
    const failure = deferred();
    const entered = deferred();
    const aborted = deferred();
    let active = 0;
    const transport = new ProgramMailTransportService(
      {
        send: () => Promise.resolve(),
        start: () => {
          active += 1;
          entered.resolve();
          let closed = false;
          return {
            promise: new Promise<void>(() => undefined),
            abort: () => {
              if (closed) return;
              closed = true;
              active -= 1;
              aborted.resolve();
            },
          };
        },
      },
      new ProgramMailTemplateService(),
    );
    const original = new Error('synthetic recipient DB write failure');
    const running = transport.runBatch([
      async () => {
        await failure.promise;
        return true;
      },
      async (scope) => {
        await scope.send(work, state);
        return true;
      },
    ]);
    await entered.promise;
    expect(active).toBe(1);

    failure.reject(original);
    await aborted.promise;
    expect(active).toBe(0);
    await jest.advanceTimersByTimeAsync(PROGRAM_MAIL_BATCH_DRAIN_MS);

    await expect(running).resolves.toEqual([
      { status: 'rejected', reason: original },
      { status: 'unsettled' },
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });
});
