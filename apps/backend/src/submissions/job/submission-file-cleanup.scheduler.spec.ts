import { Logger } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { SubmissionFileCleanupService } from '../service/submission-file-cleanup.service';
import { SubmissionFileCleanupScheduler } from './submission-file-cleanup.scheduler';

const CRON_JOB_NAME = 'submission-file-cleanup';

const settleRun = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('SubmissionFileCleanupScheduler', () => {
  let testingModule: TestingModule;
  const runDue = jest.fn<Promise<number>, []>();
  let releasePendingRun: (() => void) | undefined;

  const registry = () => testingModule.get(SchedulerRegistry);
  const registeredJob = () => registry().getCronJob(CRON_JOB_NAME);

  beforeEach(async () => {
    releasePendingRun = undefined;
    runDue.mockReset();
    runDue.mockResolvedValue(0);
    testingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        SubmissionFileCleanupScheduler,
        { provide: SubmissionFileCleanupService, useValue: { runDue } },
      ],
    }).compile();
    await testingModule.init();
  });

  afterEach(async () => {
    releasePendingRun?.();
    jest.restoreAllMocks();
    await testingModule.close();
  });

  it('정리 job 이름과 매시 정각 표현식, 프로세스 시간대, 라이브러리 완료 대기 없음으로 cron 하나를 등록한다', () => {
    const job = registeredJob();

    expect([...registry().getCronJobs().keys()]).toEqual([CRON_JOB_NAME]);
    expect(job.name).toBe(CRON_JOB_NAME);
    expect(job.cronTime.source).toBe('0 0-23/1 * * *');
    expect(job.cronTime.timeZone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(job.waitForCompletion).toBe(false);
  });

  it('등록된 cron tick 1회가 제출 파일 정리 서비스의 기한 도래 실행 1회로 위임된다', async () => {
    await registeredJob().fireOnTick();

    expect(runDue).toHaveBeenCalledTimes(1);
    expect(runDue).toHaveBeenCalledWith();
  });

  it('앞선 정리 실행이 끝나기 전 tick은 서비스 실행을 겹쳐 시작하지 않고 끝난 뒤 tick은 다시 실행한다', async () => {
    runDue.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        releasePendingRun = () => resolve(0);
      }),
    );
    const job = registeredJob();

    await job.fireOnTick();
    await job.fireOnTick();

    expect(runDue).toHaveBeenCalledTimes(1);

    releasePendingRun?.();
    await settleRun();
    await job.fireOnTick();

    expect(runDue).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'Error 실패는 오류 이름만',
      new TypeError('storage provider connection detail'),
      'TypeError',
    ],
    [
      'Error가 아닌 실패는 UnknownError만',
      'storage provider connection detail',
      'UnknownError',
    ],
  ])(
    '%s 남기고 provider 상세를 기록하지 않는다',
    async (_case, failure, errorName) => {
      runDue.mockRejectedValueOnce(failure);
      const alert = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await registeredJob().fireOnTick();
      await settleRun();

      expect(alert.mock.calls).toEqual([
        [{ event: 'submission-file.cleanup.run.failed', errorName }],
      ]);
      expect(JSON.stringify(alert.mock.calls)).not.toContain('provider');
    },
  );
});
