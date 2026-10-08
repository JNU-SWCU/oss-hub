import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import {
  COLLECTION_CRON_EXPRESSION,
  COLLECTION_CRON_JOB_NAME,
  CollectionTriggerService,
  DEFAULT_COLLECTION_CRON_EXPRESSION,
} from '../service/collection-trigger.service';
import { CollectionScheduler } from './collection.scheduler';

describe('CollectionScheduler', () => {
  let testingModule: TestingModule;
  let scheduler: CollectionScheduler;
  const runScheduled = jest.fn<Promise<void>, []>();

  const registeredJob = () =>
    testingModule.get(SchedulerRegistry).getCronJob(COLLECTION_CRON_JOB_NAME);

  beforeEach(async () => {
    runScheduled.mockReset();
    runScheduled.mockResolvedValue(undefined);
    testingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        CollectionScheduler,
        { provide: CollectionTriggerService, useValue: { runScheduled } },
      ],
    }).compile();
    await testingModule.init();
    scheduler = testingModule.get(CollectionScheduler);
  });

  afterEach(async () => {
    await testingModule.close();
  });

  it('기존 job 이름과 매시 표현식, 서울 시간대, 중복 실행 금지로 cron을 등록한다', () => {
    const job = registeredJob();

    expect(COLLECTION_CRON_JOB_NAME).toBe('collection-reconciliation');
    expect(DEFAULT_COLLECTION_CRON_EXPRESSION).toBe('0 0 * * * *');
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
