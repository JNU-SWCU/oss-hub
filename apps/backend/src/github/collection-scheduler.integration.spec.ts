import { Test, TestingModule } from '@nestjs/testing';

import { CollectionCutoverRepository } from './repository/collection-cutover.repository';
import { CollectionSchedulerService } from './service/collection-scheduler.service';
import { CollectionSyncService } from './service/collection-sync.service';
import {
  CollectionUserActivityService,
  type CollectionUserActivitySweepResult,
} from './service/collection-user-activity.service';

describe('CollectionScheduler integration', () => {
  let testingModule: TestingModule;
  let scheduler: CollectionSchedulerService;
  const run = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string]
  >();
  const runExternal = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string]
  >();
  const isQuiesced = jest.fn<Promise<boolean>, [Date]>();
  const runUserActivity = jest.fn<
    Promise<CollectionUserActivitySweepResult>,
    []
  >();

  beforeAll(async () => {
    testingModule = await Test.createTestingModule({
      providers: [
        CollectionSchedulerService,
        { provide: CollectionSyncService, useValue: { run, runExternal } },
        { provide: CollectionCutoverRepository, useValue: { isQuiesced } },
        {
          provide: CollectionUserActivityService,
          useValue: { run: runUserActivity },
        },
      ],
    }).compile();
    scheduler = testingModule.get(CollectionSchedulerService);
  });

  afterEach(() => {
    run.mockReset();
    runExternal.mockReset();
    isQuiesced.mockReset();
    runUserActivity.mockReset();
  });

  afterAll(async () => {
    await testingModule.close();
  });

  it('스케줄 실행을 증분 sync writer로 전달하고 PENDING 응답을 즉시 보존한다', async () => {
    isQuiesced.mockResolvedValue(false);
    run.mockResolvedValue({
      runId: 'synthetic-scheduler-run-id',
      status: 'COMPLETED',
    });
    runExternal.mockResolvedValue({
      runId: 'synthetic-scheduler-external-run-id',
      status: 'COMPLETED',
    });
    runUserActivity.mockResolvedValue({
      observedUserCount: 0,
      upsertedRowCount: 0,
      skippedPastYearCount: 0,
      failedUserCount: 0,
    });

    const result = await scheduler.trigger();
    expect(result.status).toBe('PENDING');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatch(/^scheduler:/);
    expect(runExternal).toHaveBeenCalledTimes(1);
    expect(runExternal.mock.calls[0]?.[0]).toBe(run.mock.calls[0]?.[0]);
  });

  it('COL_008 quiesce 거부를 변경 없이 전파한다', async () => {
    isQuiesced.mockResolvedValue(true);

    await expect(scheduler.trigger()).rejects.toMatchObject({
      errorCode: { code: 'COL_008', status: 409 },
    });
    expect(run).not.toHaveBeenCalled();
    expect(runExternal).not.toHaveBeenCalled();
    expect(runUserActivity).not.toHaveBeenCalled();
  });
});
