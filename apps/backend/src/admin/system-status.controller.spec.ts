import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RolesGuard } from '../platform/roles.guard';
import { Test } from '@nestjs/testing';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusService } from './system-status.service';

describe('SystemStatusController', () => {
  it('세션의 githubId로 서비스를 호출하고 날짜를 응답 형식으로 변환한다', async () => {
    const result = {
      collection: {
        health: 'NORMAL' as const,
        trackedRepositoryCount: 2,
        staleRepositoryCount: 0,
        lastSuccessAt: new Date('2026-07-25T11:00:00.000Z'),
        nextCycleAt: new Date('2026-07-25T20:30:00.000Z'),
        currentRunStatus: 'IDLE' as const,
        safeReason: null,
      },
      repositoryProvisioning: {
        finalFailureCount: 0,
      },
      collectionRepositories: [
        {
          repositoryName: 'JNU-SWCU/alpha',
          programName: null,
          lastSuccessAt: new Date('2026-07-25T10:00:00.000Z'),
          stale: false,
        },
      ],
      externalCollection: {
        trackedRepositoryCount: 1,
        lastSuccessAt: new Date('2026-07-25T10:30:00.000Z'),
      },
    };
    const getStatus = jest.fn<
      ReturnType<SystemStatusService['getStatus']>,
      [bigint]
    >();
    getStatus.mockResolvedValue(result);
    const testingModule = await Test.createTestingModule({
      controllers: [SystemStatusController],
      providers: [{ provide: SystemStatusService, useValue: { getStatus } }],
    }).compile();
    const controller = testingModule.get(SystemStatusController);

    await expect(controller.getStatus()).resolves.toEqual(
      JSON.parse(JSON.stringify(result)),
    );
    expect(getStatus).toHaveBeenCalledWith();
    await testingModule.close();
  });

  it('GET /system-status를 전역 인증 가드로 보호한다', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      SystemStatusController.prototype,
      'getStatus',
    )?.value;
    expect(typeof handler).toBe('function');
    if (typeof handler !== 'function') {
      throw new Error('SystemStatusController.getStatus handler is missing');
    }
    expect(Reflect.getMetadata(PATH_METADATA, SystemStatusController)).toBe(
      'system-status',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('/');
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
  });
});
