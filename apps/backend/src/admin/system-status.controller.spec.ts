import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RolesGuard } from '../platform/roles.guard';
import { OriginGuard } from '../platform/origin.guard';
import { AuthConfig } from '../platform/auth.config';
import { Test } from '@nestjs/testing';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusService } from './system-status.service';
import { TeamApplicationService } from '../programs/team-application.service';

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
      provisioning: {
        pending: 1,
        processing: 0,
        retryable: 2,
        failedFinal: 1,
        failedTeams: [
          {
            teamId: 'synthetic-team',
            teamName: '합성 팀',
            programName: '합성 프로그램',
            lastErrorCode: 'REPOSITORY_PROVISION_INTERNAL',
            updatedAt: new Date('2026-07-25T09:00:00.000Z'),
          },
        ],
      },
      mail: {
        sent7d: 4,
        failed7d: 1,
        lastSentAt: new Date('2026-07-24T23:00:00.000Z'),
      },
      anomalies: [
        {
          rule: 'PROVISIONING_FAILED' as const,
          severity: 'HIGH' as const,
          count: 1,
          target: null,
        },
        {
          rule: 'SELF_ADMIN_CHANGE' as const,
          severity: 'HIGH' as const,
          count: 1,
          target: {
            kind: 'USER' as const,
            id: 'synthetic-admin',
            login: 'synthetic-admin-login',
          },
        },
      ],
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
      providers: [
        { provide: SystemStatusService, useValue: { getStatus } },
        { provide: TeamApplicationService, useValue: {} },
        { provide: AuthConfig, useValue: {} },
      ],
    }).compile();
    const controller = testingModule.get(SystemStatusController);

    const response = await controller.getStatus();
    expect(response).toEqual(JSON.parse(JSON.stringify(result)));
    expect(Object.keys(response).sort()).toEqual([
      'anomalies',
      'collection',
      'collectionRepositories',
      'externalCollection',
      'mail',
      'provisioning',
    ]);
    expect(JSON.stringify(response)).not.toMatch(/https?:|\/dashboard/);
    expect(getStatus).toHaveBeenCalledWith();
    await testingModule.close();
  });

  it('저장소 발급 재시도를 팀 신청 서비스에 맡기고 새 요청 ID를 돌려준다', async () => {
    const retryFailedRepositoryProvision = jest.fn<
      ReturnType<TeamApplicationService['retryFailedRepositoryProvision']>,
      [string]
    >();
    retryFailedRepositoryProvision.mockResolvedValue({
      eventId: 'synthetic-event',
    });
    const testingModule = await Test.createTestingModule({
      controllers: [SystemStatusController],
      providers: [
        { provide: SystemStatusService, useValue: {} },
        {
          provide: TeamApplicationService,
          useValue: { retryFailedRepositoryProvision },
        },
        { provide: AuthConfig, useValue: {} },
      ],
    }).compile();
    const controller = testingModule.get(SystemStatusController);

    await expect(
      controller.retryProvisioning('synthetic-team'),
    ).resolves.toEqual({
      teamId: 'synthetic-team',
      requestId: 'synthetic-event',
      status: 'PENDING',
    });
    expect(retryFailedRepositoryProvision).toHaveBeenCalledWith(
      'synthetic-team',
    );
    await testingModule.close();
  });

  it('POST /system-status/provisioning/:teamId/retry를 관리자 가드와 Origin 가드로 보호한다', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      SystemStatusController.prototype,
      'retryProvisioning',
    )?.value;
    if (typeof handler !== 'function') {
      throw new Error(
        'SystemStatusController.retryProvisioning handler is missing',
      );
    }
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'provisioning/:teamId/retry',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      OriginGuard,
      RolesGuard,
    ]);
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
