import type { CollectionScheduleService } from '../github/collection-schedule.service';
import {
  SystemStatusRepository,
  type BulkRemovalEventDto,
  type CollectionExternalCollectionStatusDto,
  type CollectionRepositoryStatusDto,
  type MailStatusDto,
  type ProvisioningStatusDto,
} from './system-status.repository';
import { SystemStatusService } from './system-status.service';

const nextScheduledAt = jest.fn<
  ReturnType<CollectionScheduleService['nextScheduledCollectionAt']>,
  Parameters<CollectionScheduleService['nextScheduledCollectionAt']>
>();

const NOW = new Date('2026-07-25T12:00:00.000Z');

function repository(
  repositoryName: string,
  lastSuccessAt: Date | null,
): CollectionRepositoryStatusDto {
  return { repositoryName, programName: '2026 오픈소스', lastSuccessAt };
}

const SEVEN_DAYS_AGO = new Date('2026-07-18T12:00:00.000Z');

function provisioning(
  overrides: Partial<ProvisioningStatusDto> = {},
): ProvisioningStatusDto {
  return {
    pending: 1,
    processing: 0,
    retryable: 0,
    failedFinal: 0,
    failedTeamsHasMore: false,
    failedTeams: [],
    ...overrides,
  };
}

function mail(overrides: Partial<MailStatusDto> = {}): MailStatusDto {
  return {
    sent7d: 3,
    failed7d: 0,
    lastSentAt: new Date('2026-07-25T08:00:00.000Z'),
    ...overrides,
  };
}

function removals(
  actorId: string,
  count: number,
  startIso: string,
  spacingMs: number,
): BulkRemovalEventDto[] {
  return Array.from({ length: count }, (_, index) => ({
    actorId,
    occurredAt: new Date(Date.parse(startIso) + index * spacingMs),
  }));
}

function externalStatus(
  overrides: Partial<CollectionExternalCollectionStatusDto> = {},
): CollectionExternalCollectionStatusDto {
  return { trackedRepositoryCount: 0, lastSuccessAt: null, ...overrides };
}

describe('SystemStatusService', () => {
  const getCollectionRepositories = jest.fn();
  const hasActiveCollectionRun = jest.fn();
  const getExternalCollectionStatus = jest.fn();
  const getProvisioningStatus = jest.fn();
  const getMailStatus = jest.fn();
  const findBulkRemovalEvents = jest.fn();
  const findAdminChangeEvents = jest.fn();
  const service = new SystemStatusService(
    {
      getProvisioningStatus,
      getMailStatus,
      findBulkRemovalEvents,
      findAdminChangeEvents,
      getCollectionRepositories,
      hasActiveCollectionRun,
      getExternalCollectionStatus,
    } as unknown as SystemStatusRepository,
    () => NOW,
    { nextScheduledCollectionAt: (from: Date) => nextScheduledAt(from) },
  );

  beforeEach(() => {
    getCollectionRepositories
      .mockReset()
      .mockResolvedValue([
        repository('org/alpha', new Date('2026-07-25T11:55:00.000Z')),
        repository('org/beta', new Date('2026-07-25T11:00:00.000Z')),
      ]);
    hasActiveCollectionRun.mockReset().mockResolvedValue(false);
    nextScheduledAt
      .mockReset()
      .mockReturnValue(new Date('2026-07-25T13:00:00.000Z'));
    getExternalCollectionStatus.mockReset().mockResolvedValue(externalStatus());
    getProvisioningStatus.mockReset().mockResolvedValue(provisioning());
    getMailStatus.mockReset().mockResolvedValue(mail());
    findBulkRemovalEvents.mockReset().mockResolvedValue([]);
    findAdminChangeEvents.mockReset().mockResolvedValue([]);
  });

  it('저장소마다 repo.last_success_at과 지연 여부를 돌려준다', async () => {
    await expect(service.getStatus()).resolves.toEqual({
      collection: {
        health: 'NORMAL',
        trackedRepositoryCount: 2,
        staleRepositoryCount: 0,
        lastSuccessAt: new Date('2026-07-25T11:55:00.000Z'),
        nextCycleAt: new Date('2026-07-25T13:00:00.000Z'),
        currentRunStatus: 'IDLE',
      },
      provisioning: provisioning(),
      mail: mail(),
      anomalies: [],
      collectionRepositories: [
        {
          ...repository('org/alpha', new Date('2026-07-25T11:55:00.000Z')),
          stale: false,
        },
        {
          ...repository('org/beta', new Date('2026-07-25T11:00:00.000Z')),
          stale: false,
        },
      ],
      externalCollection: { trackedRepositoryCount: 0, lastSuccessAt: null },
    });
    expect(nextScheduledAt).toHaveBeenCalledWith(NOW);
    expect(hasActiveCollectionRun).toHaveBeenCalledWith(NOW);
    expect(getMailStatus).toHaveBeenCalledWith(SEVEN_DAYS_AGO);
    expect(findBulkRemovalEvents).toHaveBeenCalledWith(SEVEN_DAYS_AGO);
    expect(findAdminChangeEvents).toHaveBeenCalledWith(SEVEN_DAYS_AGO);
  });

  it('추적 중인 저장소가 없으면 EMPTY다', async () => {
    getCollectionRepositories.mockResolvedValue([]);

    const { collection } = await service.getStatus();

    expect(collection).toMatchObject({
      health: 'EMPTY',
      trackedRepositoryCount: 0,
      lastSuccessAt: null,
    });
  });

  it('마지막 성공이 2시간보다 오래된 저장소가 하나라도 있으면 DELAYED다', async () => {
    getCollectionRepositories.mockResolvedValue([
      repository('org/alpha', new Date('2026-07-25T11:55:00.000Z')),
      repository('org/beta', new Date('2026-07-25T09:59:59.999Z')),
    ]);

    const result = await service.getStatus();

    expect(result.collection).toMatchObject({
      health: 'DELAYED',
      staleRepositoryCount: 1,
    });
    expect(
      result.collectionRepositories.map(({ repositoryName, stale }) => [
        repositoryName,
        stale,
      ]),
    ).toEqual([
      ['org/alpha', false],
      ['org/beta', true],
    ]);
  });

  it('정확히 2시간 된 성공과 아직 수집되지 않은 저장소는 지연이 아니다', async () => {
    getCollectionRepositories.mockResolvedValue([
      repository('org/alpha', new Date('2026-07-25T10:00:00.000Z')),
      repository('org/new', null),
    ]);

    const { collection, collectionRepositories } = await service.getStatus();

    expect(collection.health).toBe('NORMAL');
    expect(collectionRepositories.every((row) => !row.stale)).toBe(true);
  });

  it('만료되지 않은 수집 잠금이 있으면 PROCESSING이다', async () => {
    hasActiveCollectionRun.mockResolvedValue(true);

    const { collection } = await service.getStatus();

    expect(collection.currentRunStatus).toBe('PROCESSING');
  });

  it('외부 저장소의 마지막 수집 성공 시각을 org 지표와 별개로 옮긴다', async () => {
    getExternalCollectionStatus.mockResolvedValue(
      externalStatus({
        trackedRepositoryCount: 3,
        lastSuccessAt: new Date('2026-07-25T10:00:00.000Z'),
      }),
    );

    const result = await service.getStatus();

    expect(result.externalCollection).toEqual({
      trackedRepositoryCount: 3,
      lastSuccessAt: new Date('2026-07-25T10:00:00.000Z'),
    });
    expect(result.collection.lastSuccessAt).toEqual(
      new Date('2026-07-25T11:55:00.000Z'),
    );
  });

  describe('이상 징후', () => {
    it('한 행위자가 10분 안에 10건 이상 반려·삭제하면 BULK_REMOVAL을 그 사용자 대상으로 낸다', async () => {
      findBulkRemovalEvents.mockResolvedValue([
        ...removals('staff-a', 10, '2026-07-24T01:00:00.000Z', 60_000),
        ...removals('staff-b', 3, '2026-07-24T01:00:00.000Z', 1_000),
      ]);

      const { anomalies } = await service.getStatus();

      expect(anomalies).toEqual([
        {
          rule: 'BULK_REMOVAL',
          severity: 'HIGH',
          count: 10,
          target: { kind: 'USER', id: 'staff-a', login: null },
        },
      ]);
    });

    it('10건이 10분 넘게 퍼져 있거나 9건이면 BULK_REMOVAL을 내지 않는다', async () => {
      findBulkRemovalEvents.mockResolvedValue([
        ...removals('staff-a', 10, '2026-07-24T01:00:00.000Z', 66_667),
        ...removals('staff-b', 9, '2026-07-24T01:00:00.000Z', 1_000),
      ]);

      const { anomalies } = await service.getStatus();

      expect(anomalies).toEqual([]);
    });

    it('관리자 권한을 자기 자신에게 바꾸면 SELF_ADMIN_CHANGE를 낸다', async () => {
      findAdminChangeEvents.mockResolvedValue([
        {
          userId: 'admin-a',
          login: 'admin-a-login',
          actorId: 'admin-a',
          occurredAt: new Date('2026-07-22T02:00:00.000Z'),
        },
        {
          userId: 'user-b',
          login: 'user-b-login',
          actorId: 'admin-a',
          occurredAt: new Date('2026-07-22T02:00:00.000Z'),
        },
      ]);

      const { anomalies } = await service.getStatus();

      expect(anomalies).toEqual([
        {
          rule: 'SELF_ADMIN_CHANGE',
          severity: 'HIGH',
          count: 1,
          target: { kind: 'USER', id: 'admin-a', login: 'admin-a-login' },
        },
      ]);
    });

    it('평일 KST 07:00~21:59 사이 다른 사람의 권한 변경은 이상 징후가 아니다', async () => {
      findAdminChangeEvents.mockResolvedValue([
        {
          userId: 'user-b',
          login: 'user-b-login',
          actorId: 'admin-a',
          occurredAt: new Date('2026-07-21T22:00:00.000Z'),
        },
        {
          userId: 'user-c',
          login: 'user-c-login',
          actorId: null,
          occurredAt: new Date('2026-07-22T12:59:59.999Z'),
        },
      ]);

      const { anomalies } = await service.getStatus();

      expect(anomalies).toEqual([]);
    });

    it('KST 22:00~07:00 또는 주말의 권한 변경은 OFF_HOURS_ADMIN_CHANGE를 대상자별로 낸다', async () => {
      findAdminChangeEvents.mockResolvedValue([
        {
          userId: 'user-b',
          login: 'user-b-login',
          actorId: 'admin-a',
          occurredAt: new Date('2026-07-22T13:00:00.000Z'),
        },
        {
          userId: 'user-b',
          login: 'user-b-login',
          actorId: 'admin-a',
          occurredAt: new Date('2026-07-21T21:59:59.999Z'),
        },
        {
          userId: 'user-c',
          login: 'user-c-login',
          actorId: 'admin-a',
          occurredAt: new Date('2026-07-25T03:00:00.000Z'),
        },
      ]);

      const { anomalies } = await service.getStatus();

      expect(anomalies).toEqual([
        {
          rule: 'OFF_HOURS_ADMIN_CHANGE',
          severity: 'MEDIUM',
          count: 2,
          target: { kind: 'USER', id: 'user-b', login: 'user-b-login' },
        },
        {
          rule: 'OFF_HOURS_ADMIN_CHANGE',
          severity: 'MEDIUM',
          count: 1,
          target: { kind: 'USER', id: 'user-c', login: 'user-c-login' },
        },
      ]);
    });

    it('최종 실패한 발급, 지연된 수집, 실패한 메일을 대상 없이 내고 HIGH를 먼저 둔다', async () => {
      getCollectionRepositories.mockResolvedValue([
        repository('org/late', new Date('2026-07-25T09:00:00.000Z')),
      ]);
      getMailStatus.mockResolvedValue(mail({ failed7d: 2 }));
      getProvisioningStatus.mockResolvedValue(provisioning({ failedFinal: 3 }));

      const { anomalies } = await service.getStatus();

      expect(anomalies).toEqual([
        {
          rule: 'PROVISIONING_FAILED',
          severity: 'HIGH',
          count: 3,
          target: null,
        },
        {
          rule: 'COLLECTION_STALE',
          severity: 'MEDIUM',
          count: 1,
          target: null,
        },
        { rule: 'MAIL_FAILED', severity: 'MEDIUM', count: 2, target: null },
      ]);
    });

    it('발급 최종 실패, 지연 저장소, 메일 실패가 0이면 해당 이상 징후가 없다', async () => {
      getProvisioningStatus.mockResolvedValue(
        provisioning({ pending: 4, processing: 1, retryable: 2 }),
      );

      const { anomalies } = await service.getStatus();

      expect(anomalies).toEqual([]);
    });
  });
});
