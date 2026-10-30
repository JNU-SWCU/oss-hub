import { Logger } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { ProgramAuthoringUploadMaintenanceService } from './program-authoring-upload-maintenance.service';
import { ProgramAuthoringUploadMaintenanceScheduler } from './program-authoring-upload-maintenance.scheduler';

function deferred(): {
  readonly promise: Promise<number>;
  readonly resolve: (value: number) => void;
} {
  let resolvePromise: ((value: number) => void) | undefined;
  const promise = new Promise<number>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) {
    throw new Error('Deferred promise was not initialized');
  }
  return { promise, resolve: resolvePromise };
}

const CRON_JOB_NAME = 'program-authoring-upload-cleanup';

describe('ProgramAuthoringUploadMaintenanceScheduler', () => {
  describe('SchedulerRegistry 등록', () => {
    let testingModule: TestingModule;
    const runDue = jest.fn<Promise<number>, []>();

    const registry = () => testingModule.get(SchedulerRegistry);
    const registeredJob = () => registry().getCronJob(CRON_JOB_NAME);

    beforeEach(async () => {
      runDue.mockReset();
      runDue.mockResolvedValue(0);
      testingModule = await Test.createTestingModule({
        imports: [ScheduleModule.forRoot()],
        providers: [
          ProgramAuthoringUploadMaintenanceScheduler,
          {
            provide: ProgramAuthoringUploadMaintenanceService,
            useValue: { runDue },
          },
        ],
      }).compile();
      await testingModule.init();
    });

    afterEach(async () => {
      await testingModule.close();
    });

    it('업로드 정리 job 이름과 매시 정각 표현식, 프로세스 시간대, 라이브러리 완료 대기 없음으로 cron 하나를 등록한다', () => {
      const job = registeredJob();

      expect([...registry().getCronJobs().keys()]).toEqual([CRON_JOB_NAME]);
      expect(job.name).toBe(CRON_JOB_NAME);
      expect(job.cronTime.source).toBe('0 0-23/1 * * *');
      expect(job.cronTime.timeZone).toBe(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      expect(job.waitForCompletion).toBe(false);
    });

    it('등록된 cron tick 1회가 업로드 정리 서비스의 기한 도래 실행 1회로 위임된다', async () => {
      await registeredJob().fireOnTick();

      expect(runDue).toHaveBeenCalledTimes(1);
      expect(runDue).toHaveBeenCalledWith();
    });
  });

  it('skips an overlapping hourly run', async () => {
    const pending = deferred();
    const maintenance: jest.Mocked<
      Pick<ProgramAuthoringUploadMaintenanceService, 'runDue'>
    > = { runDue: jest.fn().mockReturnValue(pending.promise) };
    const scheduler = new ProgramAuthoringUploadMaintenanceScheduler(
      maintenance,
    );

    const first = scheduler.run();
    await scheduler.run();
    pending.resolve(1);
    await first;

    expect(maintenance.runDue).toHaveBeenCalledTimes(1);
  });

  it('logs only a fixed safe code when a run fails', async () => {
    const maintenance: jest.Mocked<
      Pick<ProgramAuthoringUploadMaintenanceService, 'runDue'>
    > = {
      runDue: jest
        .fn()
        .mockRejectedValue(new Error('database provider connection detail')),
    };
    const alert = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const scheduler = new ProgramAuthoringUploadMaintenanceScheduler(
      maintenance,
    );

    await scheduler.run();

    expect(alert).toHaveBeenCalledWith({
      event: 'program-authoring-upload.cleanup.run.failed',
      errorCode: 'MAINTENANCE_RUN_FAILED',
    });
    expect(JSON.stringify(alert.mock.calls)).not.toContain('provider');
    alert.mockRestore();
  });
});
