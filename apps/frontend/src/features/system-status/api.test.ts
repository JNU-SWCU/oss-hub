import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import { fetchSystemStatus, triggerCollection } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('system status api', () => {
  it('GET system-status의 정확한 DTO를 반환한다', async () => {
    const dto = {
      health: 'DELAYED',
      dataAsOf: '2026-07-25T10:01:00.000Z',
      trackedRepositoryCount: 2,
      readyStreamCount: 6,
      backfillingStreamCount: 0,
      partialStreamCount: 0,
      retryPendingStreamCount: 0,
      oldestReadyCheckpointAt: '2026-07-25T09:00:00.000Z',
      oldestRetryPendingAt: null,
      lastCycleStartedAt: '2026-07-25T09:55:00.000Z',
      lastCycleCompletedAt: '2026-07-25T10:01:00.000Z',
      nextCycleAt: '2026-07-25T11:00:00.000Z',
      currentRunStatus: 'PROCESSING',
      safeReason: 'STALE_DATA',
    };
    const collectionStreams = [
      {
        repositoryName: 'jnu-oss/repo-a',
        streams: [
          {
            streamType: 'COMMIT',
            bucket: 'READY',
            lastSuccessAt: '2026-07-25T10:00:00.000Z',
            lastErrorCode: null,
            lastErrorAt: null,
          },
          {
            streamType: 'PULL_REQUEST',
            bucket: 'RETRY_PENDING',
            lastSuccessAt: '2026-07-24T10:00:00.000Z',
            lastErrorCode: 'PROVIDER_RATE_LIMITED',
            lastErrorAt: '2026-07-25T09:00:00.000Z',
          },
          {
            streamType: 'RELEASE',
            bucket: 'READY',
            lastSuccessAt: '2026-07-25T10:00:00.000Z',
            lastErrorCode: null,
            lastErrorAt: null,
          },
        ],
      },
    ];
    const collectionActivity = [
      {
        sweepFinishedAt: '2026-07-25T10:00:00.000Z',
        cycleStartedAt: '2026-07-25T09:55:00.000Z',
        scope: 'org:jnu-swcu',
        insertedCommitCount: 12,
        insertedPullRequestCount: 3,
        insertedReleaseCount: 1,
        attemptedRepositoryCount: 8,
        processedRepositoryCount: 8,
        failedRepositoryCount: 0,
        cycleCompleted: true,
        stoppedForBudget: false,
      },
    ];
    const externalCollection = {
      trackedRepositoryCount: 3,
      lastSweep: {
        sweepFinishedAt: '2026-07-25T10:00:00.000Z',
        cycleStartedAt: '2026-07-25T09:55:00.000Z',
        scope: 'external',
        insertedCommitCount: 4,
        insertedPullRequestCount: 1,
        insertedReleaseCount: 0,
        attemptedRepositoryCount: 3,
        processedRepositoryCount: 3,
        failedRepositoryCount: 0,
        cycleCompleted: true,
        stoppedForBudget: false,
      },
      cumulativeCommitCount: 40,
      cumulativePullRequestCount: 6,
      cumulativeReleaseCount: 2,
    };
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          collection: dto,
          collectionStreams,
          collectionActivity,
          externalCollection,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', request);

    await expect(fetchSystemStatus()).resolves.toEqual({
      status: dto,
      collectionStreams,
      collectionActivity,
      externalCollection,
    });
    expect(request).toHaveBeenCalledWith(apiPath('system-status'), undefined);
  });

  it('collectionStreams가 없는 구계약 응답은 빈 배열로 정규화한다(배포 window 혼재 대비)', async () => {
    const dto = {
      health: 'NORMAL',
      dataAsOf: '2026-07-25T10:01:00.000Z',
      trackedRepositoryCount: 2,
      readyStreamCount: 6,
      backfillingStreamCount: 0,
      partialStreamCount: 0,
      retryPendingStreamCount: 0,
      oldestReadyCheckpointAt: '2026-07-25T09:00:00.000Z',
      oldestRetryPendingAt: null,
      lastCycleStartedAt: '2026-07-25T09:55:00.000Z',
      lastCycleCompletedAt: '2026-07-25T10:01:00.000Z',
      nextCycleAt: null,
      currentRunStatus: 'IDLE',
      safeReason: null,
    };
    const request = vi.fn().mockResolvedValue(
      // 구버전 백엔드 응답 그대로 — collectionStreams 필드 자체가 없다.
      new Response(JSON.stringify({ collection: dto }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', request);

    await expect(fetchSystemStatus()).resolves.toEqual({
      status: dto,
      collectionStreams: [],
      collectionActivity: [],
      externalCollection: {
        trackedRepositoryCount: 0,
        lastSweep: null,
        cumulativeCommitCount: 0,
        cumulativePullRequestCount: 0,
        cumulativeReleaseCount: 0,
      },
    });
  });

  it('collectionActivity가 없는 구계약 응답도 빈 배열로 정규화한다(2단계 배포 window 혼재 대비)', async () => {
    const dto = {
      health: 'NORMAL',
      dataAsOf: '2026-07-25T10:01:00.000Z',
      trackedRepositoryCount: 2,
      readyStreamCount: 6,
      backfillingStreamCount: 0,
      partialStreamCount: 0,
      retryPendingStreamCount: 0,
      oldestReadyCheckpointAt: '2026-07-25T09:00:00.000Z',
      oldestRetryPendingAt: null,
      lastCycleStartedAt: '2026-07-25T09:55:00.000Z',
      lastCycleCompletedAt: '2026-07-25T10:01:00.000Z',
      nextCycleAt: null,
      currentRunStatus: 'IDLE',
      safeReason: null,
    };
    const collectionStreams = [
      {
        repositoryName: 'jnu-oss/repo-a',
        streams: [],
      },
    ];
    const request = vi.fn().mockResolvedValue(
      // collectionStreams는 이미 보내는(1단계 배포 완료) 구버전 백엔드 응답 —
      // collectionActivity 필드만 없다.
      new Response(JSON.stringify({ collection: dto, collectionStreams }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', request);

    await expect(fetchSystemStatus()).resolves.toEqual({
      status: dto,
      collectionStreams,
      collectionActivity: [],
      externalCollection: {
        trackedRepositoryCount: 0,
        lastSweep: null,
        cumulativeCommitCount: 0,
        cumulativePullRequestCount: 0,
        cumulativeReleaseCount: 0,
      },
    });
  });

  it('externalCollection이 없는 구계약 응답도 기본값(0/null)으로 정규화한다(3단계 배포 window 혼재 대비)', async () => {
    const dto = {
      health: 'NORMAL',
      dataAsOf: '2026-07-25T10:01:00.000Z',
      trackedRepositoryCount: 2,
      readyStreamCount: 6,
      backfillingStreamCount: 0,
      partialStreamCount: 0,
      retryPendingStreamCount: 0,
      oldestReadyCheckpointAt: '2026-07-25T09:00:00.000Z',
      oldestRetryPendingAt: null,
      lastCycleStartedAt: '2026-07-25T09:55:00.000Z',
      lastCycleCompletedAt: '2026-07-25T10:01:00.000Z',
      nextCycleAt: null,
      currentRunStatus: 'IDLE',
      safeReason: null,
    };
    const collectionStreams: unknown[] = [];
    const collectionActivity: unknown[] = [];
    const request = vi.fn().mockResolvedValue(
      // collectionStreams·collectionActivity는 이미 보내는(1·2단계 배포 완료) 구버전
      // 백엔드 응답 — externalCollection 필드만 없다.
      new Response(
        JSON.stringify({
          collection: dto,
          collectionStreams,
          collectionActivity,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', request);

    await expect(fetchSystemStatus()).resolves.toEqual({
      status: dto,
      collectionStreams: [],
      collectionActivity: [],
      externalCollection: {
        trackedRepositoryCount: 0,
        lastSweep: null,
        cumulativeCommitCount: 0,
        cumulativePullRequestCount: 0,
        cumulativeReleaseCount: 0,
      },
    });
  });

  it('전송 오류를 성공 상태로 위장하지 않고 전파한다', async () => {
    const failure = new TypeError('synthetic transport failure');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    await expect(fetchSystemStatus()).rejects.toBe(failure);
  });
});

describe('collection trigger api', () => {
  it('202 응답을 받으면 runId를 담은 결과를 반환한다', async () => {
    const dto = { status: 'PENDING', runId: 'a2c1f9e0-...' };
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(dto), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', request);

    await expect(triggerCollection()).resolves.toEqual(dto);
    expect(request).toHaveBeenCalledWith(
      apiPath('admin/collection/trigger'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('409 COL_008(전환 중)을 ApiError로 전파한다', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: '저장소 전환 작업이 진행 중이라 수집을 시작할 수 없습니다.',
      instance: apiPath('admin/collection/trigger'),
      code: 'COL_008',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(problem), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(triggerCollection()).rejects.toMatchObject({
      problem: { code: 'COL_008', status: 409 },
    });
    await expect(triggerCollection()).rejects.toBeInstanceOf(ApiError);
  });
});
