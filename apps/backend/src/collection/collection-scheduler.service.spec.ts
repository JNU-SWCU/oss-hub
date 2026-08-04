import { Logger } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { CollectionCutoverRepository } from './collection-cutover.repository';
import {
  COLLECTION_CRON_JOB_NAME,
  CollectionSchedulerService,
  DEFAULT_COLLECTION_CRON_EXPRESSION,
} from './collection-scheduler.service';
import {
  CollectionSyncService,
  type CollectionSyncRunResult,
} from './collection-sync.service';

const completedRun = (
  overrides: Partial<CollectionSyncRunResult> = {},
): CollectionSyncRunResult => ({
  runId: 'synthetic-run-id',
  status: 'COMPLETED',
  inventoryComplete: true,
  processedRepositoryCount: 1,
  cycleCompleted: true,
  stoppedForBudget: false,
  insertedFactCount: 0,
  ...overrides,
});

describe('CollectionSchedulerService', () => {
  let testingModule: TestingModule;
  let service: CollectionSchedulerService;
  const run = jest.fn<Promise<CollectionSyncRunResult>, [string]>();
  const isQuiesced = jest.fn<Promise<boolean>, [Date]>();

  beforeEach(async () => {
    run.mockReset();
    isQuiesced.mockReset();
    isQuiesced.mockResolvedValue(false);
    testingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        CollectionSchedulerService,
        { provide: CollectionSyncService, useValue: { run } },
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
    run.mockResolvedValue(completedRun());

    const result = await service.trigger();
    expect(result.status).toBe('PENDING');
    expect(typeof result.runId).toBe('string');
    await expect(service.handleCron()).resolves.toBeUndefined();

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toMatch(/^scheduler:/);
    expect(run.mock.calls[1]?.[0]).toBe(run.mock.calls[0]?.[0]);
  });

  it('quiesce lease가 걸려 있으면 COL_008로 트리거를 거부하고 새 writer를 호출하지 않는다', async () => {
    isQuiesced.mockResolvedValue(true);

    await expect(service.trigger()).rejects.toMatchObject({
      errorCode: { code: 'COL_008', status: 409 },
    });
    expect(run).not.toHaveBeenCalled();
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

  // #511 — 성공 tick에도 로그가 1줄 남아야 한다. 이전에는 실패 이벤트만 기록돼
  // "정상 실행됐는가"를 DB 직접 조회 없이 판정할 수 없었다.
  it('sync가 성공하면 소요 시간·대상 repo 수·신규 수집 건수를 담은 완료 로그를 남긴다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    run.mockResolvedValue(
      completedRun({ processedRepositoryCount: 9, insertedFactCount: 12 }),
    );

    await expect(service.handleCron()).resolves.toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'collection.scheduler.completed',
        syncStatus: 'COMPLETED',
        repositoryCount: 9,
        insertedFactCount: 12,
        inventoryComplete: true,
        cycleCompleted: true,
        stoppedForBudget: false,
      }),
    );
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: expect.any(Number) as unknown }),
    );
  });

  it('완료 로그에 자격증명·저장소 이름이 섞이지 않는다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    run.mockResolvedValue({
      ...completedRun(),
      // 계약에 없는 필드를 결과에 섞어도 로그로 새지 않아야 한다.
      installationToken: 'must-not-be-logged',
      nameWithOwner: 'JNU-SWCU/secret-repo',
    } as CollectionSyncRunResult);

    await expect(service.handleCron()).resolves.toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));

    const serialized = JSON.stringify(logger.mock.calls);
    expect(serialized).not.toContain('must-not-be-logged');
    expect(serialized).not.toContain('secret-repo');
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
});
