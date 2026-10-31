import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import {
  RepositoryOutboxConsumerService,
  type RepositoryOutboxConsumeResult,
} from './repository-outbox-consumer.service';
import type {
  RepositoryProvisionResult,
  RepositoryProvisionWorkerService,
} from './repository-provision-worker.service';
import type { RepositoriesRepository } from './repositories.repository';

describe('RepositoryOutboxConsumerService scheduling', () => {
  const NOW = new Date('2026-07-22T00:00:00.000Z');
  const LATER = new Date('2026-07-22T00:00:01.000Z');
  const INTERVAL_NAME = 'repository-provision';

  describe('poll', () => {
    describe('SchedulerRegistry 등록', () => {
      let testingModule: TestingModule;
      const consumeNext = jest.fn<
        Promise<RepositoryOutboxConsumeResult>,
        [string, Date]
      >();
      const runNext = jest.fn<Promise<RepositoryProvisionResult>, [string]>();

      const settlePoll = (): Promise<void> =>
        new Promise((resolve) => setImmediate(resolve));

      beforeEach(async () => {
        jest.useFakeTimers({
          doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
        });
        consumeNext.mockReset();
        consumeNext.mockResolvedValue({ kind: 'EMPTY' });
        runNext.mockReset();
        runNext.mockResolvedValue({ kind: 'EMPTY' });
        const service = new RepositoryOutboxConsumerService(
          {} as RepositoriesRepository,
          { runNext },
        );
        service.consumeNext = consumeNext;
        testingModule = await Test.createTestingModule({
          imports: [ScheduleModule.forRoot()],
          providers: [
            { provide: RepositoryOutboxConsumerService, useValue: service },
          ],
        }).compile();
        await testingModule.init();
      });

      afterEach(async () => {
        await testingModule.close();
        jest.useRealTimers();
      });

      it('repository-provision 이름의 interval 하나만 등록하고 cron은 등록하지 않는다', () => {
        const registry = testingModule.get(SchedulerRegistry);

        expect(registry.getIntervals()).toEqual([INTERVAL_NAME]);
        expect(registry.getInterval(INTERVAL_NAME)).toBeDefined();
        expect(registry.getCronJobs().size).toBe(0);
      });

      it('등록된 interval은 5초마다 outbox 소비와 provision 실행을 한 번씩 위임한다', async () => {
        jest.advanceTimersByTime(4_999);
        await settlePoll();

        expect(consumeNext).not.toHaveBeenCalled();
        expect(runNext).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        await settlePoll();

        expect(consumeNext).toHaveBeenCalledTimes(1);
        expect(consumeNext).toHaveBeenCalledWith(
          expect.stringMatching(/^repository-/),
          expect.any(Date),
        );
        expect(runNext).toHaveBeenCalledTimes(1);
        expect(runNext).toHaveBeenCalledWith(consumeNext.mock.calls[0]?.[0]);

        jest.advanceTimersByTime(5_000);
        await settlePoll();

        expect(consumeNext).toHaveBeenCalledTimes(2);
        expect(runNext).toHaveBeenCalledTimes(2);
      });
    });

    it('outbox와 job을 각각 빈 결과까지 bounded batch로 처리한다', async () => {
      const worker = {
        runNext: jest
          .fn()
          .mockResolvedValueOnce({
            kind: 'SUCCEEDED',
            jobId: 'synthetic-job-id',
            repositoryId: 'synthetic-repository-id',
          })
          .mockResolvedValueOnce({ kind: 'EMPTY' }),
      } as jest.Mocked<Pick<RepositoryProvisionWorkerService, 'runNext'>>;
      const now = jest
        .fn<Date, []>()
        .mockReturnValueOnce(NOW)
        .mockReturnValueOnce(LATER)
        .mockReturnValueOnce(LATER)
        .mockReturnValue(LATER);
      const scheduler = new RepositoryOutboxConsumerService(
        {} as RepositoriesRepository,
        worker,
        now,
      );
      const consumeNext = jest
        .spyOn(scheduler, 'consumeNext')
        .mockResolvedValueOnce({
          kind: 'CONSUMED',
          eventId: 'synthetic-event-id',
          jobId: 'synthetic-job-id',
        })
        .mockResolvedValueOnce({
          kind: 'FAILED',
          eventId: 'synthetic-event-id',
        })
        .mockResolvedValueOnce({ kind: 'EMPTY' });

      await scheduler.runBatch();

      expect(consumeNext.mock.calls).toHaveLength(3);
      expect(worker.runNext.mock.calls).toHaveLength(2);
      expect(consumeNext.mock.calls[0]?.[1]).toBe(NOW);
      expect(consumeNext.mock.calls[1]?.[1]).toBe(LATER);
      expect(worker.runNext.mock.calls[0]).toEqual([expect.any(String)]);
    });
  });
});
