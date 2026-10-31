import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import {
  COLLECTION_CRON_EXPRESSION,
  COLLECTION_CRON_JOB_NAME,
  CollectionTriggerService,
} from './collection-trigger.service';
import { Logger } from '@nestjs/common';
import { CollectionCutoverRepository } from './repository-provision-job.repository';
import {
  CollectionSyncService,
  type CollectionSyncRunResult,
} from './collection-sync.service';
import {
  CollectionUserActivityService,
  type CollectionUserActivitySweepResult,
} from './collection-user-activity.service';

describe('collection cron', () => {
  describe('CollectionTriggerService.handleCron', () => {
    let testingModule: TestingModule;
    let scheduler: CollectionTriggerService;
    const runScheduled = jest.fn<Promise<void>, []>();

    const registeredJob = () =>
      testingModule.get(SchedulerRegistry).getCronJob(COLLECTION_CRON_JOB_NAME);

    beforeEach(async () => {
      runScheduled.mockReset();
      runScheduled.mockResolvedValue(undefined);
      scheduler = new CollectionTriggerService(
        {} as CollectionSyncService,
        {} as CollectionCutoverRepository,
        {} as CollectionUserActivityService,
      );
      scheduler.runScheduled = runScheduled;
      testingModule = await Test.createTestingModule({
        imports: [ScheduleModule.forRoot()],
        providers: [{ provide: CollectionTriggerService, useValue: scheduler }],
      }).compile();
      await testingModule.init();
    });

    afterEach(async () => {
      await testingModule.close();
    });

    it('기존 job 이름과 매시 표현식, 서울 시간대, 중복 실행 금지로 cron을 등록한다', () => {
      const job = registeredJob();

      expect(COLLECTION_CRON_JOB_NAME).toBe('collection-reconciliation');
      expect(COLLECTION_CRON_EXPRESSION).toBe('0 0 * * * *');
      expect(job.cronTime.source).toBe(COLLECTION_CRON_EXPRESSION);
      expect(job.cronTime.timeZone).toBe('Asia/Seoul');
      expect(job.waitForCompletion).toBe(true);
    });

    it('등록된 cron tick 1회가 수집 진입 서비스의 예약 실행 1회로 위임된다', async () => {
      await registeredJob().fireOnTick();

      expect(runScheduled).toHaveBeenCalledTimes(1);
      expect(runScheduled).toHaveBeenCalledWith();
    });

    it('handleCron은 예약 실행 결과를 그대로 돌려주고 자체 상태를 두지 않는다', async () => {
      await expect(scheduler.handleCron()).resolves.toBeUndefined();
      await expect(scheduler.handleCron()).resolves.toBeUndefined();

      expect(runScheduled).toHaveBeenCalledTimes(2);
    });

    it('실패 분류는 서비스가 소유하므로 job은 실패를 감싸거나 삼키지 않는다', async () => {
      runScheduled.mockRejectedValue(new Error('scheduled sweep failed'));

      await expect(scheduler.handleCron()).rejects.toThrow(
        'scheduled sweep failed',
      );
    });

    it('앞선 tick이 끝나기 전 다음 tick은 예약 실행을 겹쳐 시작하지 않는다', async () => {
      let release: (() => void) | undefined;
      const scheduledRun = new Promise<void>((resolve) => {
        release = resolve;
      });
      runScheduled.mockReturnValue(scheduledRun);
      const job = registeredJob();

      const firstTick = job.fireOnTick();
      await Promise.resolve();
      await job.fireOnTick();

      expect(runScheduled).toHaveBeenCalledTimes(1);

      release?.();
      await firstTick;

      expect(runScheduled).toHaveBeenCalledTimes(1);
    });
  });
});

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

describe('CollectionTriggerService', () => {
  let testingModule: TestingModule;
  let service: CollectionTriggerService;
  const run = jest.fn<Promise<CollectionSyncRunResult>, [string]>();
  const runExternal = jest.fn<Promise<CollectionSyncRunResult>, [string]>();
  const runRepository = jest.fn<
    Promise<CollectionSyncRunResult>,
    [string, bigint, string]
  >();
  const isQuiesced = jest.fn<Promise<boolean>, [Date]>();
  const runUserActivity = jest.fn<
    Promise<CollectionUserActivitySweepResult>,
    []
  >();

  beforeEach(async () => {
    run.mockReset();
    runUserActivity.mockReset();
    runUserActivity.mockResolvedValue({
      observedUserCount: 3,
      upsertedRowCount: 3,
      skippedPastYearCount: 0,
      failedUserCount: 0,
    });
    runExternal.mockReset();
    runRepository.mockReset();
    runRepository.mockResolvedValue(
      completedRun({ inventoryComplete: null, cycleCompleted: false }),
    );
    runExternal.mockResolvedValue(
      completedRun({ runId: 'synthetic-external-run-id' }),
    );
    isQuiesced.mockReset();
    isQuiesced.mockResolvedValue(false);
    testingModule = await Test.createTestingModule({
      providers: [
        CollectionTriggerService,
        {
          provide: CollectionSyncService,
          useValue: { run, runExternal, runRepository },
        },
        { provide: CollectionCutoverRepository, useValue: { isQuiesced } },
        {
          provide: CollectionUserActivityService,
          useValue: { run: runUserActivity },
        },
      ],
    }).compile();
    await testingModule.init();
    service = testingModule.get(CollectionTriggerService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await testingModule.close();
  });

  it('수동 진입점과 cron이 동일한 sync use case를 즉시 PENDING으로 응답하며 시작한다', async () => {
    run.mockResolvedValue(completedRun());

    const result = await service.trigger();
    expect(result.status).toBe('PENDING');
    expect(typeof result.runId).toBe('string');
    await expect(service.runScheduled()).resolves.toBeUndefined();

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toMatch(/^scheduler:/);
    expect(run.mock.calls[1]?.[0]).toBe(run.mock.calls[0]?.[0]);
  });

  it('org sweep과 함께 E1 external sweep도 같은 quiesce guard 안에서 시작한다', async () => {
    run.mockResolvedValue(completedRun());

    await service.trigger();
    await expect(service.runScheduled()).resolves.toBeUndefined();

    expect(runExternal).toHaveBeenCalledTimes(2);
    expect(runExternal.mock.calls[0]?.[0]).toMatch(/^scheduler:/);
    expect(runExternal.mock.calls[1]?.[0]).toBe(runExternal.mock.calls[0]?.[0]);

    expect(runExternal.mock.calls[0]?.[0]).toBe(run.mock.calls[0]?.[0]);
  });

  it('quiesce lease가 걸려 있으면 COL_008로 트리거를 거부하고 새 writer를 호출하지 않는다', async () => {
    isQuiesced.mockResolvedValue(true);

    await expect(service.trigger()).rejects.toMatchObject({
      errorCode: { code: 'COL_008', status: 409 },
    });
    expect(run).not.toHaveBeenCalled();
    expect(runExternal).not.toHaveBeenCalled();
    expect(runUserActivity).not.toHaveBeenCalled();
  });

  it('cron tick 1회가 org·external·person 세 sweep을 모두 관측한다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    run.mockResolvedValue(completedRun());

    await expect(service.runScheduled()).resolves.toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));

    expect(run).toHaveBeenCalledTimes(1);
    expect(runExternal).toHaveBeenCalledTimes(1);
    expect(runUserActivity).toHaveBeenCalledTimes(1);
    const scopes = logger.mock.calls
      .map(([entry]) => (entry as { scope?: string }).scope)
      .filter((scope): scope is string => typeof scope === 'string');
    expect(new Set(scopes)).toEqual(new Set(['org', 'external', 'person']));
  });

  it('사람 축 sweep 성공은 집계 수치만 담은 완료 로그 1줄을 남긴다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    run.mockResolvedValue(completedRun());
    runUserActivity.mockResolvedValue({
      observedUserCount: 51,
      upsertedRowCount: 50,
      skippedPastYearCount: 0,
      failedUserCount: 1,
    });

    await expect(service.runScheduled()).resolves.toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'collection.scheduler.completed',
        scope: 'person',
        observedUserCount: 51,
        upsertedRowCount: 50,
        skippedPastYearCount: 0,
        failedUserCount: 1,
      }),
    );
  });

  it('사람 축 sweep 실패는 org·external sweep이나 트리거 응답에 영향을 주지 않는다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    run.mockResolvedValue(completedRun());
    runUserActivity.mockRejectedValue(
      Object.assign(new Error('person sweep unavailable'), {
        token: 'must-not-be-logged',
      }),
    );

    await expect(service.trigger()).resolves.toEqual(
      expect.objectContaining({ status: 'PENDING' }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(run).toHaveBeenCalledTimes(1);
    expect(runExternal).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'collection.scheduler.person_sync_failed',
        scope: 'person',
        errorName: 'Error',
      }),
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain(
      'must-not-be-logged',
    );
    expect(logger).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'collection.scheduler.sync_failed' }),
    );
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

    await expect(service.runScheduled()).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalledWith({
      event: 'collection.scheduler.failed',
      errorName: 'Error',
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain('private');
    expect(JSON.stringify(logger.mock.calls)).not.toContain(
      'must-not-be-logged',
    );
  });

  it('트리거가 만든 runId를 그대로 내부 sync run에 넘긴다', async () => {
    run.mockResolvedValue(completedRun());

    const result = await service.trigger();

    expect(run).toHaveBeenCalledWith(expect.any(String), result.runId);
  });

  it('sync가 성공하면 소요 시간·대상 repo 수·신규 수집 건수를 담은 완료 로그를 남긴다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    run.mockResolvedValue(
      completedRun({ processedRepositoryCount: 9, insertedFactCount: 12 }),
    );

    await expect(service.runScheduled()).resolves.toBeUndefined();
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

      installationToken: 'must-not-be-logged',
      nameWithOwner: 'JNU-SWCU/secret-repo',
    } as CollectionSyncRunResult);

    await expect(service.runScheduled()).resolves.toBeUndefined();
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

  it('백그라운드 external sweep 실패는 트리거 응답이나 org sweep에 영향을 주지 않고 별도 이벤트로 기록된다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    run.mockResolvedValue(completedRun());
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

  it('연결 직후 수집은 스케줄러 소유자로 저장소 1건만 돌리고 완료를 로그 1줄로 남긴다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    expect(service.collectRepository(555n)).toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));

    expect(runRepository).toHaveBeenCalledWith(
      expect.stringMatching(/^scheduler:/),
      555n,
      expect.any(String),
    );
    expect(run).not.toHaveBeenCalled();
    expect(runExternal).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'collection.scheduler.completed',
        scope: 'repository',
        syncStatus: 'COMPLETED',
      }),
    );
  });

  it('quiesce 중에는 연결 직후 수집을 돌리지 않고 호출자 대신 로그로 거부를 남긴다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    isQuiesced.mockResolvedValue(true);

    expect(() => service.collectRepository(555n)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(runRepository).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'collection.scheduler.repository_sync_failed',
        scope: 'repository',
        errorName: 'DomainException',
      }),
    );
  });
});
