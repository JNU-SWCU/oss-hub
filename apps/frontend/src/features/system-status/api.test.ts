import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import { fetchSystemStatus, triggerCollection } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('system status api', () => {
  it('GET system-status의 정확한 DTO를 반환한다', async () => {
    const dto = {
      health: 'DELAYED',
      trackedRepositoryCount: 2,
      staleRepositoryCount: 1,
      lastSuccessAt: '2026-07-25T10:00:00.000Z',
      nextCycleAt: '2026-07-25T11:00:00.000Z',
      currentRunStatus: 'PROCESSING',
      safeReason: 'STALE_DATA',
    };
    const collectionRepositories = [
      {
        repositoryName: 'jnu-oss/repo-a',
        programName: '오픈소스 입문 프로그램',
        lastSuccessAt: '2026-07-25T10:00:00.000Z',
        stale: false,
      },
      {
        repositoryName: 'jnu-oss/repo-b',
        programName: null,
        lastSuccessAt: '2026-07-25T07:00:00.000Z',
        stale: true,
      },
    ];
    const externalCollection = {
      trackedRepositoryCount: 3,
      lastSuccessAt: '2026-07-25T10:00:00.000Z',
    };
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          collection: dto,
          collectionRepositories,
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
      collectionRepositories,
      externalCollection,
    });
    expect(request).toHaveBeenCalledWith(apiPath('system-status'), undefined);
  });

  it('externalCollection이 없는 응답은 기본값(0/null)으로 정규화한다', async () => {
    const dto = {
      health: 'NORMAL',
      trackedRepositoryCount: 0,
      staleRepositoryCount: 0,
      lastSuccessAt: null,
      nextCycleAt: null,
      currentRunStatus: 'IDLE',
      safeReason: null,
    };
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ collection: dto, collectionRepositories: [] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', request);

    await expect(fetchSystemStatus()).resolves.toEqual({
      status: dto,
      collectionRepositories: [],
      externalCollection: {
        trackedRepositoryCount: 0,
        lastSuccessAt: null,
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
