import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';

import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { CollectionAdminController } from './collection-admin.controller';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionCutoverRepository } from './collection-cutover.repository';
import { CollectionSyncService } from './collection-sync.service';

describe('CollectionAdminController', () => {
  const run = jest.fn<
    Promise<{ runId: string; status: 'COMPLETED' }>,
    [string]
  >();
  const isQuiesced = jest.fn<Promise<boolean>, [Date]>();

  beforeEach(() => {
    run.mockReset();
    isQuiesced.mockReset();
    isQuiesced.mockResolvedValue(false);
  });

  it('실행을 시작하고 202 응답 DTO를 반환한다', async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [CollectionAdminController],
      providers: [
        { provide: CollectionSyncService, useValue: { run } },
        { provide: CollectionCutoverRepository, useValue: { isQuiesced } },
      ],
    })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CollectionAdminGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OriginGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const controller = testingModule.get(CollectionAdminController);
    run.mockResolvedValue({
      runId: 'synthetic-scheduler-run-id',
      status: 'COMPLETED',
    });

    const result = await controller.trigger();
    expect(result.status).toBe('PENDING');
    expect(typeof result.runId).toBe('string');
    await testingModule.close();
  });

  it('quiesce lease가 걸려 있으면 COL_008을 던지고 새 writer를 호출하지 않는다', async () => {
    isQuiesced.mockResolvedValue(true);
    const controller = new CollectionAdminController(
      { run } as unknown as CollectionSyncService,
      { isQuiesced } as unknown as CollectionCutoverRepository,
    );

    await expect(controller.trigger()).rejects.toMatchObject({
      errorCode: { code: 'COL_008', status: 409 },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('세션, ADMIN 역할, origin 순서로 보호하고 HTTP 202를 선언한다', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      CollectionAdminController.prototype,
      'trigger',
    )?.value;
    expect(typeof handler).toBe('function');
    if (typeof handler !== 'function') {
      return;
    }
    const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, handler);
    const statusCode: unknown = Reflect.getMetadata(
      HTTP_CODE_METADATA,
      handler,
    );

    expect(guards).toEqual([SessionGuard, CollectionAdminGuard, OriginGuard]);
    expect(statusCode).toBe(202);
  });
});
