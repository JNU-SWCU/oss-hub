import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import { fetchSystemStatus, retryProvisioning, triggerCollection } from './api';

afterEach(() => vi.unstubAllGlobals());

const sections = {
  collection: {
    health: 'DELAYED',
    trackedRepositoryCount: 2,
    staleRepositoryCount: 1,
    lastSuccessAt: '2026-07-25T10:00:00.000Z',
    nextCycleAt: '2026-07-25T11:00:00.000Z',
    currentRunStatus: 'PROCESSING',
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
        lastErrorCode: 'NAME_CONFLICT',
        updatedAt: '2026-07-25T09:00:00.000Z',
      },
    ],
  },
  mail: { sent7d: 4, failed7d: 1, lastSentAt: '2026-07-25T08:00:00.000Z' },
  anomalies: [
    { rule: 'PROVISIONING_FAILED', severity: 'HIGH', count: 1, target: null },
  ],
  collectionRepositories: [
    {
      repositoryName: 'jnu-oss/repo-a',
      teamName: null,
      programName: null,
      lastSuccessAt: '2026-07-25T06:00:00.000Z',
      stale: true,
    },
  ],
  externalCollection: {
    trackedRepositoryCount: 3,
    lastSuccessAt: '2026-07-24T10:00:00.000Z',
  },
};

function stubResponse(body: unknown, status = 200) {
  const request = vi.fn().mockResolvedValue(
    new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', request);
  return request;
}

describe('system status api', () => {
  it('GET system-status의 저장소 목록과 외부 수집까지 여섯 구역을 반환한다', async () => {
    const request = stubResponse(sections);

    await expect(fetchSystemStatus()).resolves.toEqual(sections);
    expect(request).toHaveBeenCalledWith(apiPath('system-status'), undefined);
  });

  it('이상 징후와 저장소 목록이 빈 배열이어도 정상 응답으로 받는다', async () => {
    stubResponse({ ...sections, anomalies: [], collectionRepositories: [] });

    await expect(fetchSystemStatus()).resolves.toMatchObject({
      anomalies: [],
      collectionRepositories: [],
    });
  });

  it.each([
    'collection',
    'provisioning',
    'mail',
    'anomalies',
    'collectionRepositories',
    'externalCollection',
  ] as const)(
    '%s 구역이 없는 응답은 이상 없음으로 위장하지 않고 거부한다',
    async (missing) => {
      stubResponse({ ...sections, [missing]: undefined });

      await expect(fetchSystemStatus()).rejects.toThrow(
        '시스템 상태 응답 형식이 올바르지 않습니다',
      );
    },
  );

  it('본문이 없는 성공 응답도 거부한다', async () => {
    stubResponse(undefined);

    await expect(fetchSystemStatus()).rejects.toThrow(
      '시스템 상태 응답 형식이 올바르지 않습니다',
    );
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
    const request = stubResponse(dto, 202);

    await expect(triggerCollection()).resolves.toEqual(dto);
    expect(request).toHaveBeenCalledWith(
      apiPath('admin/collection/trigger'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('409 COL_006(진행 중)을 ApiError로 전파한다', async () => {
    stubResponse(
      {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '수집이 이미 진행 중입니다.',
        instance: apiPath('admin/collection/trigger'),
        code: 'COL_006',
      },
      409,
    );

    await expect(triggerCollection()).rejects.toMatchObject({
      problem: { code: 'COL_006', status: 409 },
    });
  });
});

describe('provisioning retry api', () => {
  it('팀 ID를 경로에 인코딩해 POST한다', async () => {
    const request = stubResponse(
      {
        teamId: 'seed:team/1',
        requestId: 'synthetic-request',
        status: 'PENDING',
      },
      202,
    );

    await expect(retryProvisioning('seed:team/1')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      apiPath('system-status/provisioning/seed%3Ateam%2F1/retry'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('409 APP_037(다시 시도할 수 없음)을 ApiError로 전파한다', async () => {
    stubResponse(
      {
        type: 'about:blank',
        title: 'CONFLICT',
        status: 409,
        detail: '최종 실패한 저장소 발급만 다시 시도할 수 있습니다.',
        instance: apiPath('system-status/provisioning/synthetic-team/retry'),
        code: 'APP_037',
      },
      409,
    );

    const failure = await retryProvisioning('synthetic-team').catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      problem: { code: 'APP_037', status: 409 },
    });
  });
});
