import { Test, TestingModule } from '@nestjs/testing';

import { CollectionReconciliationService } from './collection-reconciliation.service';
import { CollectionSchedulerService } from './collection-scheduler.service';

describe('CollectionScheduler integration', () => {
  let testingModule: TestingModule;
  let scheduler: CollectionSchedulerService;
  const trigger = jest.fn<
    Promise<{ runId: string; status: 'PENDING' }>,
    [string]
  >();

  beforeAll(async () => {
    testingModule = await Test.createTestingModule({
      providers: [
        CollectionSchedulerService,
        { provide: CollectionReconciliationService, useValue: { trigger } },
      ],
    }).compile();
    scheduler = testingModule.get(CollectionSchedulerService);
  });

  afterEach(() => {
    trigger.mockReset();
  });

  afterAll(async () => {
    await testingModule.close();
  });

  it('스케줄 실행을 REST reconciliation으로 전달하고 PENDING 응답을 보존한다', async () => {
    trigger.mockResolvedValue({
      runId: 'synthetic-scheduler-run-id',
      status: 'PENDING',
    });

    await expect(scheduler.trigger()).resolves.toEqual({
      runId: 'synthetic-scheduler-run-id',
      status: 'PENDING',
    });
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0]?.[0]).toMatch(/^scheduler:/);
  });

  it('COL_006 충돌을 변경 없이 전파한다', async () => {
    const conflict = Object.assign(new Error('수집이 이미 진행 중입니다.'), {
      errorCode: { code: 'COL_006', status: 409 },
    });
    trigger.mockRejectedValue(conflict);

    await expect(scheduler.trigger()).rejects.toBe(conflict);
  });
});
