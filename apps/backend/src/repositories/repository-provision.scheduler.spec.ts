import type { RepositoryOutboxConsumer } from './repository-outbox.consumer';
import { RepositoryProvisionScheduler } from './repository-provision.scheduler';
import type { RepositoryProvisionWorker } from './repository-provision.worker';

const NOW = new Date('2026-07-22T00:00:00.000Z');

describe('RepositoryProvisionScheduler', () => {
  it('outbox와 job을 각각 빈 결과까지 bounded batch로 처리한다', async () => {
    // Given: outbox 두 건과 job 한 건 뒤 queue가 빈다.
    const outbox = {
      consumeNext: jest
        .fn()
        .mockResolvedValueOnce({ kind: 'CONSUMED' })
        .mockResolvedValueOnce({ kind: 'FAILED' })
        .mockResolvedValueOnce({ kind: 'EMPTY' }),
    } as jest.Mocked<Pick<RepositoryOutboxConsumer, 'consumeNext'>>;
    const worker = {
      runNext: jest
        .fn()
        .mockResolvedValueOnce({
          kind: 'SUCCEEDED',
          jobId: 'synthetic-job-id',
          repositoryId: 'synthetic-repository-id',
        })
        .mockResolvedValueOnce({ kind: 'EMPTY' }),
    } as jest.Mocked<Pick<RepositoryProvisionWorker, 'runNext'>>;
    const scheduler = new RepositoryProvisionScheduler(outbox, worker);

    // When: 한 polling batch를 실행한다.
    await scheduler.runBatch(NOW);

    // Then: 각 queue가 빈 시점에 즉시 멈춘다.
    expect(outbox.consumeNext.mock.calls).toHaveLength(3);
    expect(worker.runNext.mock.calls).toHaveLength(2);
    expect(outbox.consumeNext.mock.calls[0]?.[1]).toBe(NOW);
    expect(worker.runNext.mock.calls[0]?.[1]).toBe(NOW);
  });
});
