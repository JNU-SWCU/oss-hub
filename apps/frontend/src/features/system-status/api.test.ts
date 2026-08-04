import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import {
  discoverExternalRepositories,
  fetchSystemStatus,
  triggerCollection,
} from './api';

// 실제 학생 계정이 아닌 합성 fixture — PUBLIC repo에 실명/실제 계정을 남기지 않는다.
const SYNTHETIC_GITHUB_LOGIN = 'synthetic-test-login';

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
      currentRunStatus: 'PROCESSING',
      safeReason: 'STALE_DATA',
    };
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ collection: dto }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', request);

    await expect(fetchSystemStatus()).resolves.toEqual(dto);
    expect(request).toHaveBeenCalledWith(apiPath('system-status'), undefined);
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

describe('discover external repositories api', () => {
  it('200 응답을 받으면 4개 집계 필드를 모두 담은 결과를 반환한다', async () => {
    const dto = {
      status: 'COMPLETED',
      githubLogin: SYNTHETIC_GITHUB_LOGIN,
      discoveredCount: 5,
      upsertedCount: 3,
      skippedOrgProvisionedCount: 2,
    };
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(dto), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', request);

    await expect(
      discoverExternalRepositories({ githubLogin: SYNTHETIC_GITHUB_LOGIN }),
    ).resolves.toEqual(dto);
    expect(request).toHaveBeenCalledWith(
      apiPath('admin/collection/discover-external'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ githubLogin: SYNTHETIC_GITHUB_LOGIN }),
      }),
    );
  });

  it('404 COL_009(학생 없음)을 ApiError로 전파한다', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: '해당 GitHub 계정으로 등록된 학생을 찾을 수 없습니다.',
      instance: apiPath('admin/collection/discover-external'),
      code: 'COL_009',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(problem), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(
      discoverExternalRepositories({ githubLogin: SYNTHETIC_GITHUB_LOGIN }),
    ).rejects.toMatchObject({
      problem: { code: 'COL_009', status: 404 },
    });
    await expect(
      discoverExternalRepositories({ githubLogin: SYNTHETIC_GITHUB_LOGIN }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
