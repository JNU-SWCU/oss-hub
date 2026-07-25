import { ForbiddenException } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import type { CanonicalRunStatus } from '../collection/collection-canonical.types';
import type { SystemStatusSnapshot } from './system-status.repository';
import { SystemStatusRepository } from './system-status.repository';
import { SystemStatusService } from './system-status.service';

const NOW = new Date('2026-07-25T12:00:00.000Z');
const ACTOR_ID = 133n;

function snapshot(
  overrides: Partial<SystemStatusSnapshot> = {},
): SystemStatusSnapshot {
  return {
    appId: 1n,
    organizationLogin: 'org',
    activeGenerationId: 'run-1',
    runId: 'run-1',
    errorClass: null,
    updatedAt: NOW,
    permissionsValid: true,
    installationValid: true,
    runStatus: 'SUCCEEDED',
    lastCompleteSuccessAt: new Date('2026-07-25T11:00:00.000Z'),
    dataAsOf: new Date('2026-07-25T11:00:00.000Z'),
    ...overrides,
  };
}

describe('SystemStatusService', () => {
  const findActor = jest.fn();
  const getStatusSnapshot = jest.fn();
  const service = new SystemStatusService(
    { findActor, getStatusSnapshot } as unknown as SystemStatusRepository,
    () => NOW,
  );

  beforeEach(() => {
    findActor.mockReset().mockResolvedValue({
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    });
    getStatusSnapshot.mockReset().mockResolvedValue(snapshot());
  });

  it('ACTIVE ADMIN에게만 정확한 공개 DTO를 반환한다', async () => {
    await expect(service.getStatus(ACTOR_ID)).resolves.toEqual({
      collection: {
        health: 'NORMAL',
        lastCompleteSuccessAt: '2026-07-25T11:00:00.000Z',
        dataAsOf: '2026-07-25T11:00:00.000Z',
        currentRunStatus: 'IDLE',
        safeReason: null,
      },
    });
    expect(findActor).toHaveBeenCalledWith(ACTOR_ID);
    expect(getStatusSnapshot).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['없는 사용자', null],
    ['비 ADMIN', { role: Role.STAFF, accountStatus: AccountStatus.ACTIVE }],
    [
      '비활성 ADMIN',
      { role: Role.ADMIN, accountStatus: AccountStatus.DEACTIVATED },
    ],
  ])('%s는 거부하고 상태 데이터를 조회하지 않는다', async (_label, actor) => {
    findActor.mockResolvedValue(actor);
    await expect(service.getStatus(ACTOR_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(getStatusSnapshot).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<SystemStatusSnapshot>, string, string]>([
    [
      'permission이 installation보다 우선한다',
      {
        permissionsValid: false,
        installationValid: false,
        lastCompleteSuccessAt: null,
        runStatus: 'FAILED',
      },
      'FAILED',
      'PERMISSION_INVALID',
    ],
    [
      'installation이 no data보다 우선한다',
      {
        installationValid: false,
        lastCompleteSuccessAt: null,
        runStatus: 'FAILED',
      },
      'FAILED',
      'INSTALLATION_INVALID',
    ],
    [
      'no data가 run 상태보다 우선한다',
      { lastCompleteSuccessAt: null, runStatus: 'FAILED' },
      'FAILED',
      'NO_COMPLETE_DATA',
    ],
    [
      'incomplete를 먼저 판정한다',
      {
        runStatus: 'INCOMPLETE',
        dataAsOf: new Date('2026-07-25T00:00:00.000Z'),
      },
      'DELAYED',
      'RUN_INCOMPLETE',
    ],
    [
      'rate limit을 stale보다 먼저 판정한다',
      {
        runStatus: 'RATE_LIMITED',
        dataAsOf: new Date('2026-07-25T00:00:00.000Z'),
      },
      'DELAYED',
      'UPSTREAM_RATE_LIMITED',
    ],
    [
      'failed를 stale보다 먼저 판정한다',
      { runStatus: 'FAILED', dataAsOf: new Date('2026-07-25T00:00:00.000Z') },
      'DELAYED',
      'RUN_FAILED',
    ],
    [
      '90분보다 오래된 데이터만 stale이다',
      { dataAsOf: new Date('2026-07-25T10:29:59.999Z') },
      'DELAYED',
      'STALE_DATA',
    ],
  ])('%s', async (_label, overrides, health, safeReason) => {
    getStatusSnapshot.mockResolvedValue(snapshot(overrides));
    await expect(service.getStatus(ACTOR_ID)).resolves.toMatchObject({
      collection: { health, safeReason },
    });
  });

  it('정확히 90분 경계는 NORMAL이다', async () => {
    getStatusSnapshot.mockResolvedValue(
      snapshot({ dataAsOf: new Date('2026-07-25T10:30:00.000Z') }),
    );
    await expect(service.getStatus(ACTOR_ID)).resolves.toMatchObject({
      collection: { health: 'NORMAL', safeReason: null },
    });
  });

  it.each<[CanonicalRunStatus | null, string]>([
    ['PENDING', 'PENDING'],
    ['PROCESSING', 'PROCESSING'],
    ['SUCCEEDED', 'IDLE'],
    ['INCOMPLETE', 'IDLE'],
    ['RATE_LIMITED', 'IDLE'],
    ['FAILED', 'IDLE'],
    [null, 'IDLE'],
  ])(
    'canonical run %s를 currentRunStatus %s로 매핑한다',
    async (runStatus, expected) => {
      getStatusSnapshot.mockResolvedValue(snapshot({ runStatus }));
      await expect(service.getStatus(ACTOR_ID)).resolves.toMatchObject({
        collection: { currentRunStatus: expected },
      });
    },
  );
});
