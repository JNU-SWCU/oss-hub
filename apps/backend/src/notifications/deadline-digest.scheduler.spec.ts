import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { DeadlineDigestService } from './deadline-digest.service';
import { DeadlineDigestScheduler } from './deadline-digest.scheduler';

describe('DeadlineDigestScheduler', () => {
  let testingModule: TestingModule;
  let scheduler: DeadlineDigestScheduler;
  const sendDeadlineDigests = jest.fn<Promise<void>, []>();

  const registeredJobs = () => [
    ...testingModule.get(SchedulerRegistry).getCronJobs().values(),
  ];
  const onlyRegisteredJob = () => {
    const [job, ...others] = registeredJobs();
    if (job === undefined || others.length > 0) {
      throw new Error(
        `expected exactly one cron job, got ${registeredJobs().length}`,
      );
    }
    return job;
  };

  beforeEach(async () => {
    sendDeadlineDigests.mockReset();
    sendDeadlineDigests.mockResolvedValue(undefined);
    testingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        DeadlineDigestScheduler,
        { provide: DeadlineDigestService, useValue: { sendDeadlineDigests } },
      ],
    }).compile();
    await testingModule.init();
    scheduler = testingModule.get(DeadlineDigestScheduler);
  });

  afterEach(async () => {
    await testingModule.close();
  });

  it('이름 없이 매일 09시 표현식과 서울 시간대, 라이브러리 완료 대기 없음으로 cron 하나를 등록한다', () => {
    expect(registeredJobs()).toHaveLength(1);
    const job = onlyRegisteredJob();

    expect(job.name).toBeUndefined();
    expect(job.cronTime.source).toBe('0 09 * * *');
    expect(job.cronTime.timeZone).toBe('Asia/Seoul');
    expect(job.waitForCompletion).toBe(false);
  });

  it('등록된 cron tick 1회가 마감 다이제스트 발송 1회로 위임되고 기준 시각은 서비스가 정한다', async () => {
    await onlyRegisteredJob().fireOnTick();

    expect(sendDeadlineDigests).toHaveBeenCalledTimes(1);
    expect(sendDeadlineDigests).toHaveBeenCalledWith();
  });

  it('run은 발송 실패를 감싸거나 삼키지 않는다', async () => {
    sendDeadlineDigests.mockRejectedValue(new Error('digest delivery failed'));

    await expect(scheduler.run()).rejects.toThrow('digest delivery failed');
  });
});
