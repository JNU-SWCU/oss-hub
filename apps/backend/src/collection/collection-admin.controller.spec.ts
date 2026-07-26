import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';

import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { CollectionAdminController } from './collection-admin.controller';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionReconciliationService } from './collection-reconciliation.service';

describe('CollectionAdminController', () => {
  const trigger = jest.fn<
    Promise<{ runId: string; status: 'PENDING' }>,
    [string]
  >();

  beforeEach(() => {
    trigger.mockReset();
  });

  it('실행을 시작하고 202 응답 DTO를 반환한다', async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [CollectionAdminController],
      providers: [
        { provide: CollectionReconciliationService, useValue: { trigger } },
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
    trigger.mockResolvedValue({
      runId: 'synthetic-scheduler-run-id',
      status: 'PENDING',
    });

    await expect(controller.trigger()).resolves.toEqual({
      runId: 'synthetic-scheduler-run-id',
      status: 'PENDING',
    });
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0]?.[0]).toMatch(/^admin:/);
    await testingModule.close();
  });

  it('COL_006 충돌을 변경 없이 전파한다', async () => {
    const conflict = Object.assign(new Error('수집이 이미 진행 중입니다.'), {
      errorCode: { code: 'COL_006', status: 409 },
    });
    trigger.mockRejectedValue(conflict);
    const controller = new CollectionAdminController({
      trigger,
    } as unknown as CollectionReconciliationService);

    await expect(controller.trigger()).rejects.toBe(conflict);
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
