import { Test, TestingModule } from '@nestjs/testing';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';

import { CollectionConfig } from './collection.config';
import {
  CollectionExecution,
  COLLECTION_CRON_JOB_NAME,
  CollectionSchedulerService,
  DEFAULT_COLLECTION_CRON_EXPRESSION,
} from './collection-scheduler.service';
import { CollectionService } from './collection.service';
import {
  COLLECTION_RUN_STATUSES,
  COLLECTION_TRIGGERS,
  CollectionRun,
} from './domain/collection-run';

const succeededRun: CollectionRun = {
  id: 'synthetic-run-id',
  targetGithubId: 424242n,
  targetLogin: 'synthetic-login',
  trigger: COLLECTION_TRIGGERS.BATCH,
  status: COLLECTION_RUN_STATUSES.SUCCEEDED,
  profileCount: 1,
  repoCount: 1,
  eventCount: 1,
  retryNotBeforeAt: null,
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  finishedAt: new Date('2026-01-01T00:00:01.000Z'),
};

const failedRun: CollectionRun = {
  ...succeededRun,
  status: COLLECTION_RUN_STATUSES.FAILED,
};

describe('CollectionSchedulerService', () => {
  let testingModule: TestingModule;
  let service: CollectionSchedulerService;
  let batchLogins: string[];
  const runBatch = jest.fn<Promise<CollectionRun[]>, [string[]]>();

  beforeEach(async () => {
    batchLogins = ['synthetic-login'];
    testingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        CollectionSchedulerService,
        { provide: CollectionService, useValue: { runBatch } },
        {
          provide: CollectionConfig,
          useValue: {
            get batchLogins(): string[] {
              return batchLogins;
            },
          },
        },
      ],
    }).compile();
    await testingModule.init();
    service = testingModule.get(CollectionSchedulerService);
    runBatch.mockReset();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await testingModule.close();
  });

  it('매일 서울 시간 03시에 중복 대기 방식으로 cron을 등록한다', () => {
    const registry = testingModule.get(SchedulerRegistry);
    const job = registry.getCronJob(COLLECTION_CRON_JOB_NAME);

    expect(job.cronTime.source).toBe(DEFAULT_COLLECTION_CRON_EXPRESSION);
    expect(job.cronTime.timeZone).toBe('Asia/Seoul');
    expect(job.waitForCompletion).toBe(true);
  });

  it('empty batch 설정의 수동 실행은 수집 호출 없이 완료한다', async () => {
    batchLogins = [];

    const execution = service.trigger();

    await expect(execution.completion).resolves.toBeUndefined();
    expect(runBatch).not.toHaveBeenCalled();
  });

  it('empty batch 설정의 cron 실행은 수집 호출 없이 완료한다', async () => {
    batchLogins = [];

    const completion = service.handleCron();

    await expect(completion).resolves.toBeUndefined();
    expect(runBatch).not.toHaveBeenCalled();
  });

  it('같은 실행 중에는 하나의 실행만 공유한다', async () => {
    let finishBatch: ((runs: CollectionRun[]) => void) | undefined;
    runBatch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishBatch = resolve;
        }),
    );

    const first = service.trigger();
    const second = service.trigger();

    expect(second.runId).toBe(first.runId);
    expect(runBatch).toHaveBeenCalledTimes(1);

    finishBatch?.([succeededRun]);
    await expect(first.completion).resolves.toBeUndefined();
  });

  it('실패하면 5분, 15분, 45분 뒤 세 번까지 재시도한다', async () => {
    jest.useFakeTimers();
    runBatch
      .mockResolvedValueOnce([failedRun])
      .mockResolvedValueOnce([failedRun])
      .mockResolvedValueOnce([failedRun])
      .mockResolvedValueOnce([succeededRun]);

    const execution = service.trigger();
    expect(runBatch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(runBatch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    expect(runBatch).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(45 * 60_000);

    await expect(execution.completion).resolves.toBeUndefined();
    expect(runBatch).toHaveBeenCalledTimes(4);
  });

  it('세 번의 재시도 후에도 실패하면 실행을 실패로 끝낸다', async () => {
    jest.useFakeTimers();
    runBatch.mockResolvedValue([failedRun]);

    const execution = service.trigger();
    await jest.advanceTimersByTimeAsync(65 * 60_000);

    await expect(execution.completion).rejects.toMatchObject({
      name: 'CollectionBatchFailedError',
    });
    expect(runBatch).toHaveBeenCalledTimes(4);
  });

  it('여러 대상 중 실패한 대상만 다시 수집한다', async () => {
    jest.useFakeTimers();
    batchLogins = ['synthetic-login', 'retry-login'];
    runBatch
      .mockResolvedValueOnce([
        succeededRun,
        { ...failedRun, targetLogin: 'retry-login' },
      ])
      .mockResolvedValueOnce([{ ...succeededRun, targetLogin: 'retry-login' }]);

    const execution = service.trigger();
    await jest.advanceTimersByTimeAsync(5 * 60_000);

    expect(runBatch).toHaveBeenNthCalledWith(1, [
      'synthetic-login',
      'retry-login',
    ]);
    expect(runBatch).toHaveBeenNthCalledWith(2, ['retry-login']);
    await expect(execution.completion).resolves.toBeUndefined();
  });

  it('cron 진입점은 최종 실패를 전파해 프로세스를 종료하지 않는다', async () => {
    jest.useFakeTimers();
    runBatch.mockResolvedValue([failedRun]);

    const cronCompletion = service.handleCron();
    await jest.advanceTimersByTimeAsync(65 * 60_000);

    await expect(cronCompletion).resolves.toBeUndefined();
  });

  it('실행 완료 후에는 새 실행을 시작한다', async () => {
    runBatch.mockResolvedValue([succeededRun]);

    const first: CollectionExecution = service.trigger();
    await first.completion;
    const second = service.trigger();

    expect(second.runId).not.toBe(first.runId);
    await expect(second.completion).resolves.toBeUndefined();
    expect(runBatch).toHaveBeenCalledTimes(2);
  });
});
