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
const TWO_HOURS_AGO = new Date('2026-07-25T10:00:00.000Z');

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
  const getCollectionRepositorySummary = jest.fn();
  const listStaleCollectionRepositories = jest.fn();
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
      getCollectionRepositorySummary,
      listStaleCollectionRepositories,
      hasActiveCollectionRun,
      getExternalCollectionStatus,
    } as unknown as SystemStatusRepository,
    () => NOW,
    { nextScheduledCollectionAt: (from: Date) => nextScheduledAt(from) },
  );

  beforeEach(() => {
    getCollectionRepositorySummary.mockReset().mockResolvedValue({
      trackedRepositoryCount: 2,
      staleRepositoryCount: 0,
      lastSuccessAt: new Date('2026-07-25T11:55:00.000Z'),
    });
    listStaleCollectionRepositories.mockReset().mockResolvedValue([]);
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

  it('수집 요약과 지연 저장소 페이지를 돌려준다', async () => {
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
      staleRepositories: { items: [], total: 0 },
      externalCollection: { trackedRepositoryCount: 0, lastSuccessAt: null },
    });
    expect(nextScheduledAt).toHaveBeenCalledWith(NOW);
    expect(getCollectionRepositorySummary).toHaveBeenCalledWith(TWO_HOURS_AGO);
    expect(listStaleCollectionRepositories).toHaveBeenCalledWith(
      TWO_HOURS_AGO,
      {
        page: 1,
        limit: 10,
      },
    );
    expect(hasActiveCollectionRun).toHaveBeenCalledWith(NOW);
    expect(getMailStatus).toHaveBeenCalledWith(SEVEN_DAYS_AGO);
    expect(findBulkRemovalEvents).toHaveBeenCalledWith(SEVEN_DAYS_AGO);
    expect(findAdminChangeEvents).toHaveBeenCalledWith(SEVEN_DAYS_AGO);
  });

  it('추적 중인 저장소가 없으면 EMPTY다', async () => {
    getCollectionRepositorySummary.mockResolvedValue({
      trackedRepositoryCount: 0,
      staleRepositoryCount: 0,
      lastSuccessAt: null,
    });

    const { collection } = await service.getStatus();

    expect(collection).toMatchObject({
      health: 'EMPTY',
      trackedRepositoryCount: 0,
      lastSuccessAt: null,
    });
  });

  it('지연 저장소가 하나라도 있으면 DELAYED이고 요청한 페이지와 총수를 싣는다', async () => {
    getCollectionRepositorySummary.mockResolvedValue({
      trackedRepositoryCount: 30,
      staleRepositoryCount: 12,
      lastSuccessAt: new Date('2026-07-25T11:55:00.000Z'),
    });
    listStaleCollectionRepositories.mockResolvedValue([
      repository('org/beta', new Date('2026-07-25T09:59:59.999Z')),
    ]);

    const result = await service.getStatus({
      staleRepositoryPage: 2,
      staleRepositoryLimit: 11,
    });

    expect(result.collection).toMatchObject({
      health: 'DELAYED',
      trackedRepositoryCount: 30,
      staleRepositoryCount: 12,
    });
    expect(result.staleRepositories).toEqual({
      items: [repository('org/beta', new Date('2026-07-25T09:59:59.999Z'))],
      total: 12,
    });
    expect(listStaleCollectionRepositories).toHaveBeenCalledWith(
      TWO_HOURS_AGO,
      {
        page: 2,
        limit: 11,
      },
    );
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
      getCollectionRepositorySummary.mockResolvedValue({
        trackedRepositoryCount: 1,
        staleRepositoryCount: 1,
        lastSuccessAt: new Date('2026-07-25T09:00:00.000Z'),
      });
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
