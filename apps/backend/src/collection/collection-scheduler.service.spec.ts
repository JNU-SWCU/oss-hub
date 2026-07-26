import { Logger } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { CollectionReconciliationService } from './collection-reconciliation.service';
import {
  COLLECTION_CRON_JOB_NAME,
  CollectionSchedulerService,
  DEFAULT_COLLECTION_CRON_EXPRESSION,
} from './collection-scheduler.service';

describe('CollectionSchedulerService', () => {
  let testingModule: TestingModule;
  let service: CollectionSchedulerService;
  const trigger = jest.fn<
    Promise<{ runId: string; status: 'PENDING' }>,
    [string]
  >();

  beforeEach(async () => {
    trigger.mockReset();
    testingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        CollectionSchedulerService,
        { provide: CollectionReconciliationService, useValue: { trigger } },
      ],
    }).compile();
    await testingModule.init();
    service = testingModule.get(CollectionSchedulerService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await testingModule.close();
  });

  it('매시간 서울 시간 기준으로 cron을 등록한다', () => {
    const registry = testingModule.get(SchedulerRegistry);
    const job = registry.getCronJob(COLLECTION_CRON_JOB_NAME);

    expect(DEFAULT_COLLECTION_CRON_EXPRESSION).toBe('0 0 * * * *');
    expect(job.cronTime.source).toBe(DEFAULT_COLLECTION_CRON_EXPRESSION);
    expect(job.cronTime.timeZone).toBe('Asia/Seoul');
    expect(job.waitForCompletion).toBe(true);
  });

  it('수동 진입점과 cron이 동일한 reconciliation use case를 사용한다', async () => {
    trigger.mockResolvedValue({ runId: 'synthetic-run-id', status: 'PENDING' });

    await expect(service.trigger()).resolves.toEqual({
      runId: 'synthetic-run-id',
      status: 'PENDING',
    });
    await expect(service.handleCron()).resolves.toBeUndefined();

    expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger.mock.calls[0]?.[0]).toMatch(/^scheduler:/);
    expect(trigger.mock.calls[1]?.[0]).toBe(trigger.mock.calls[0]?.[0]);
  });

  it('durable lease가 판단하도록 동시에 들어온 요청을 각각 전달한다', async () => {
    let resolveFirst:
      ((value: { runId: string; status: 'PENDING' }) => void) | undefined;
    trigger
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ runId: 'second-run-id', status: 'PENDING' });

    const first = service.trigger();
    const second = service.trigger();

    expect(trigger).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toEqual({
      runId: 'second-run-id',
      status: 'PENDING',
    });
    resolveFirst?.({ runId: 'first-run-id', status: 'PENDING' });
    await expect(first).resolves.toEqual({
      runId: 'first-run-id',
      status: 'PENDING',
    });
  });

  it('cron 실패를 안전한 분류만 기록하고 프로세스로 전파하지 않는다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    trigger.mockRejectedValue(
      Object.assign(new Error('private installation detail'), {
        token: 'must-not-be-logged',
      }),
    );

    await expect(service.handleCron()).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalledWith({
      event: 'collection.scheduler.failed',
      errorName: 'Error',
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain('private');
    expect(JSON.stringify(logger.mock.calls)).not.toContain(
      'must-not-be-logged',
    );
  });
});
