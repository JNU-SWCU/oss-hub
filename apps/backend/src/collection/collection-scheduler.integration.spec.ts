import { Test, TestingModule } from '@nestjs/testing';

import { CollectionCutoverRepository } from './collection-cutover.repository';
import { CollectionSchedulerService } from './collection-scheduler.service';
import { CollectionSyncService } from './collection-sync.service';

describe('CollectionScheduler integration', () => {
  let testingModule: TestingModule;
  let scheduler: CollectionSchedulerService;
  const run = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string]
  >();
  const isQuiesced = jest.fn<Promise<boolean>, [Date]>();

  beforeAll(async () => {
    testingModule = await Test.createTestingModule({
      providers: [
        CollectionSchedulerService,
        { provide: CollectionSyncService, useValue: { run } },
        { provide: CollectionCutoverRepository, useValue: { isQuiesced } },
      ],
    }).compile();
    scheduler = testingModule.get(CollectionSchedulerService);
  });

  afterEach(() => {
    run.mockReset();
    isQuiesced.mockReset();
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

    const result = await scheduler.trigger();
    expect(result.status).toBe('PENDING');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatch(/^scheduler:/);
  });

  it('COL_008 quiesce 거부를 변경 없이 전파한다', async () => {
    isQuiesced.mockResolvedValue(true);

    await expect(scheduler.trigger()).rejects.toMatchObject({
      errorCode: { code: 'COL_008', status: 409 },
    });
    expect(run).not.toHaveBeenCalled();
  });
});
