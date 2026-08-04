import { Logger } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { CollectionCutoverRepository } from './collection-cutover.repository';
import {
  COLLECTION_CRON_JOB_NAME,
  CollectionSchedulerService,
  DEFAULT_COLLECTION_CRON_EXPRESSION,
} from './collection-scheduler.service';
import { CollectionSyncService } from './collection-sync.service';

describe('CollectionSchedulerService', () => {
  let testingModule: TestingModule;
  let service: CollectionSchedulerService;
  const run = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string]
  >();
  const runExternal = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string]
  >();
  const isQuiesced = jest.fn<Promise<boolean>, [Date]>();

  beforeEach(async () => {
    run.mockReset();
    runExternal.mockReset();
    runExternal.mockResolvedValue({
      runId: 'synthetic-external-run-id',
      status: 'COMPLETED',
    });
    isQuiesced.mockReset();
    isQuiesced.mockResolvedValue(false);
    testingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        CollectionSchedulerService,
        { provide: CollectionSyncService, useValue: { run, runExternal } },
        { provide: CollectionCutoverRepository, useValue: { isQuiesced } },
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

  it('수동 진입점과 cron이 동일한 sync use case를 즉시 PENDING으로 응답하며 시작한다', async () => {
    run.mockResolvedValue({ runId: 'synthetic-run-id', status: 'COMPLETED' });

    const result = await service.trigger();
    expect(result.status).toBe('PENDING');
    expect(typeof result.runId).toBe('string');
    await expect(service.handleCron()).resolves.toBeUndefined();

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toMatch(/^scheduler:/);
    expect(run.mock.calls[1]?.[0]).toBe(run.mock.calls[0]?.[0]);
  });

  it('org sweep과 함께 E1 external sweep도 같은 quiesce guard 안에서 시작한다', async () => {
    run.mockResolvedValue({ runId: 'synthetic-run-id', status: 'COMPLETED' });

    await service.trigger();
    await expect(service.handleCron()).resolves.toBeUndefined();

    expect(runExternal).toHaveBeenCalledTimes(2);
    expect(runExternal.mock.calls[0]?.[0]).toMatch(/^scheduler:/);
    expect(runExternal.mock.calls[1]?.[0]).toBe(runExternal.mock.calls[0]?.[0]);
    // org sweep과 external sweep은 같은 ownerId를 공유한다(lease scope만 다르다).
    expect(runExternal.mock.calls[0]?.[0]).toBe(run.mock.calls[0]?.[0]);
  });

  it('quiesce lease가 걸려 있으면 COL_008로 트리거를 거부하고 새 writer를 호출하지 않는다', async () => {
    isQuiesced.mockResolvedValue(true);

    await expect(service.trigger()).rejects.toMatchObject({
      errorCode: { code: 'COL_008', status: 409 },
    });
    expect(run).not.toHaveBeenCalled();
    expect(runExternal).not.toHaveBeenCalled();
  });

  it('cron 실패를 안전한 분류만 기록하고 프로세스로 전파하지 않는다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    isQuiesced.mockRejectedValue(
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

  it('백그라운드 sync 실패는 트리거 응답에 영향을 주지 않고 안전하게 기록된다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    run.mockRejectedValue(new Error('provider unavailable'));

    await expect(service.trigger()).resolves.toEqual(
      expect.objectContaining({ status: 'PENDING' }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'collection.scheduler.sync_failed' }),
    );
  });

  it('백그라운드 external sweep 실패는 트리거 응답이나 org sweep에 영향을 주지 않고 별도 이벤트로 기록된다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    run.mockResolvedValue({ runId: 'synthetic-run-id', status: 'COMPLETED' });
    runExternal.mockRejectedValue(new Error('external provider unavailable'));

    await expect(service.trigger()).resolves.toEqual(
      expect.objectContaining({ status: 'PENDING' }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(run).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'collection.scheduler.external_sync_failed',
      }),
    );
    expect(logger).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'collection.scheduler.sync_failed' }),
    );
  });
});
