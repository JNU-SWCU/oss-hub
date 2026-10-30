import { Logger } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { SubmissionFileCleanupService } from './submission-file-cleanup.service';
import type { ObjectStoragePort } from '../platform/object-storage.types';
import type { SubmissionFilesRepository } from './submission-files.repository';
import { SubmissionFileCleanupScheduler } from './submission-file-cleanup.scheduler';

describe('submission-file-cleanup.scheduler', () => {
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
        const alert = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation();

        await registeredJob().fireOnTick();
        await settleRun();

        expect(alert.mock.calls).toEqual([
          [{ event: 'submission-file.cleanup.run.failed', errorName }],
        ]);
        expect(JSON.stringify(alert.mock.calls)).not.toContain('provider');
      },
    );
  });
});

const START = new Date('2026-07-25T00:00:00.000Z');

function setup() {
  let now = new Date(START);
  const files = {
    claimNextForDeletion: jest.fn(),
    markDeleted: jest.fn().mockResolvedValue(true),
    recordDeleteFailure: jest.fn().mockResolvedValue(true),
    resetDeleteAttempts: jest.fn().mockResolvedValue(true),
  };
  const storage = { delete: jest.fn().mockResolvedValue(undefined) };
  const service = new SubmissionFileCleanupService(
    files as unknown as SubmissionFilesRepository,
    storage as unknown as ObjectStoragePort,
    () => new Date(now),
  );
  const setNow = (value: Date): void => {
    now = new Date(value);
  };
  return {
    service,
    files,
    storage,
    setNow,
  };
}

function claimed(deleteAttemptCount: number) {
  return {
    id: 'opaque-file-id',
    storageKey: 'private/object',
    deleteAttemptCount,
    claimOwner: 'claim-owner',
  };
}

describe('SubmissionFileCleanupService', () => {
  it('claims with a ten-minute lease and treats storage not-found as success', async () => {
    const { service, files, storage } = setup();
    files.claimNextForDeletion
      .mockResolvedValueOnce(claimed(0))
      .mockResolvedValueOnce(null);
    storage.delete.mockResolvedValueOnce(undefined);

    await expect(service.runDue()).resolves.toBe(1);

    expect(files.claimNextForDeletion).toHaveBeenNthCalledWith(1, {
      now: START,
      leaseExpiresAt: new Date('2026-07-25T00:10:00.000Z'),
    });
    expect(files.markDeleted).toHaveBeenCalledWith(
      'opaque-file-id',
      'claim-owner',
      START,
    );
  });

  it.each([
    [0, 1, 1],
    [1, 2, 2],
    [2, 3, 4],
    [3, 4, 8],
    [4, 5, 24],
  ])(
    'schedules failure after prior attempt %i as attempt %i in %ih',
    async (priorAttempts, attemptCount, delayHours) => {
      const { service, files, storage } = setup();
      files.claimNextForDeletion
        .mockResolvedValueOnce(claimed(priorAttempts))
        .mockResolvedValueOnce(null);
      storage.delete.mockRejectedValueOnce(new Error('secret provider detail'));

      await service.runDue();

      expect(files.recordDeleteFailure).toHaveBeenCalledWith({
        id: 'opaque-file-id',
        claimOwner: 'claim-owner',
        attemptCount,
        nextAttemptAt: new Date(START.getTime() + delayHours * 60 * 60 * 1_000),
        error: 'STORAGE_DELETE_FAILED',
      });
    },
  );

  it('leaves the sixth failure exhausted without another due time and alerts redacted data', async () => {
    const { service, files, storage } = setup();
    const alert = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    files.claimNextForDeletion
      .mockResolvedValueOnce(claimed(5))
      .mockResolvedValueOnce(null);
    storage.delete.mockRejectedValueOnce(new Error('credential=do-not-log'));

    await service.runDue();

    expect(files.recordDeleteFailure).toHaveBeenCalledWith({
      id: 'opaque-file-id',
      claimOwner: 'claim-owner',
      attemptCount: 6,
      nextAttemptAt: null,
      error: 'STORAGE_DELETE_FAILED',
    });
    expect(alert).toHaveBeenCalledWith({
      event: 'submission-file.cleanup.exhausted',
      fileId: 'opaque-file-id',
      attemptCount: 6,
      error: 'storage_delete_failed',
    });
    expect(JSON.stringify(alert.mock.calls)).not.toContain('credential');
    alert.mockRestore();
  });

  it('does not alert when the claim was concurrently lost before failure was recorded', async () => {
    const { service, files, storage } = setup();
    const alert = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    files.claimNextForDeletion
      .mockResolvedValueOnce(claimed(5))
      .mockResolvedValueOnce(null);
    files.recordDeleteFailure.mockResolvedValueOnce(false);
    storage.delete.mockRejectedValueOnce(new Error('provider-secret'));

    await service.runDue();

    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('allows an operator reset to be reclaimed with attempt zero', async () => {
    const { service, files, storage, setNow } = setup();
    const resetAt = new Date('2026-07-26T12:00:00.000Z');
    setNow(resetAt);
    await files.resetDeleteAttempts('opaque-file-id', resetAt);
    files.claimNextForDeletion
      .mockResolvedValueOnce(claimed(0))
      .mockResolvedValueOnce(null);

    await service.runDue();

    expect(files.resetDeleteAttempts.mock.calls).toContainEqual([
      'opaque-file-id',
      resetAt,
    ]);
    expect(storage.delete.mock.calls).toContainEqual(['private/object']);
  });
});
