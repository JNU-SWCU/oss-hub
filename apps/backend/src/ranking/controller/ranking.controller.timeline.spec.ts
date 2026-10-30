import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import {
  HTTP_AUTH_KINDS,
  type OptionalSessionRequest,
} from '../../auth/controller/http-auth';
import type { RankingTimeline } from '../domain/ranking-timeline';
import { RankingController } from './ranking.controller';
import { RankingService } from '../service/ranking.service';

describe('RankingController.findTimeline', () => {
  const findTimeline = jest.fn<Promise<RankingTimeline>, unknown[]>();
  const controller = new RankingController({
    findTimeline,
  } as unknown as RankingService);

  function timeline(
    viewerClass: RankingTimeline['viewerClass'],
    viewerGithubLogin: string | null,
  ): RankingTimeline {
    return {
      year: 2026,
      viewerClass,
      viewerGithubLogin,
      dataAsOf: new Date('2026-10-31T02:00:00.000Z'),
      points: [
        { date: '2026-01-31', starEstimated: true },
        { date: '2026-10-31', starEstimated: false },
      ],
      series: [
        { githubLogin: 'alpha', ranks: [1, 1], totals: [5, 100] },
        { githubLogin: 'bravo', ranks: [null, 2], totals: [null, 50] },
      ],
    };
  }

  function requestWithAuth(githubId: bigint | null): OptionalSessionRequest {
    return {
      headers: {},
      auth:
        githubId === null
          ? { kind: HTTP_AUTH_KINDS.ANONYMOUS, hasSessionCookie: false }
          : {
              kind: HTTP_AUTH_KINDS.AUTHENTICATED,
              hasSessionCookie: true,
              principal: { githubId, sessionVersion: 0 },
            },
    } as unknown as OptionalSessionRequest;
  }

  function recordingResponse(): {
    readonly response: Response;
    readonly headers: Map<string, string>;
  } {
    const headers = new Map<string, string>();
    const response = {
      setHeader: (name: string, value: string) => headers.set(name, value),
    } as unknown as Response;
    return { response, headers };
  }

  beforeEach(() => {
    findTimeline.mockReset();
  });

  it('public 응답의 계열에는 totals 키 자체가 없고 no-store 만 내린다', async () => {
    findTimeline.mockResolvedValue(timeline('public', null));
    const { response, headers } = recordingResponse();

    const body = await controller.findTimeline(
      { year: '2026' },
      requestWithAuth(null),
      response,
    );

    expect(Object.keys(body.series[0] ?? {}).sort()).toEqual([
      'githubLogin',
      'ranks',
    ]);
    for (const series of body.series) {
      expect(series).not.toHaveProperty('totals');
    }
    expect(JSON.stringify(body)).not.toContain('totals');
    expect(body.points).toEqual([
      { date: '2026-01-31', starEstimated: true },
      { date: '2026-10-31', starEstimated: false },
    ]);
    expect(body.viewerGithubLogin).toBeNull();
    expect(body.dataAsOf).toBe('2026-10-31T02:00:00.000Z');
    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(headers.has('Vary')).toBe(false);
    expect(findTimeline).toHaveBeenCalledWith(2026, null);
  });

  it.each(['member', 'staff'] as const)(
    '%s 응답은 totals 를 싣고 private, no-store + Vary Cookie 를 내린다',
    async (viewerClass) => {
      findTimeline.mockResolvedValue(timeline(viewerClass, 'mina'));
      const { response, headers } = recordingResponse();

      const body = await controller.findTimeline(
        { year: '2026' },
        requestWithAuth(4242n),
        response,
      );

      expect(body.series).toEqual([
        { githubLogin: 'alpha', ranks: [1, 1], totals: [5, 100] },
        { githubLogin: 'bravo', ranks: [null, 2], totals: [null, 50] },
      ]);
      expect(body.viewerGithubLogin).toBe('mina');
      expect(headers.get('Cache-Control')).toBe('private, no-store');
      expect(headers.get('Vary')).toBe('Cookie');
      expect(findTimeline).toHaveBeenCalledWith(2026, 4242n);
    },
  );

  it('year=all 은 400 이고 서비스까지 내려가지 않는다', async () => {
    await expect(
      controller.findTimeline(
        { year: 'all' },
        requestWithAuth(null),
        recordingResponse().response,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findTimeline).not.toHaveBeenCalled();
  });

  it('year 가 없으면 Asia/Seoul 기준 올해를 쓴다', async () => {
    findTimeline.mockResolvedValue(timeline('public', null));
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-12-31T15:30:00.000Z'));
    try {
      await controller.findTimeline(
        {},
        requestWithAuth(null),
        recordingResponse().response,
      );
    } finally {
      jest.useRealTimers();
    }

    expect(findTimeline).toHaveBeenCalledWith(2027, null);
  });

  it('지점이 없는 연도도 빈 배열 그대로 내려간다', async () => {
    findTimeline.mockResolvedValue({
      year: 2025,
      viewerClass: 'public',
      viewerGithubLogin: null,
      dataAsOf: null,
      points: [],
      series: [],
    });

    const body = await controller.findTimeline(
      { year: '2025' },
      requestWithAuth(null),
      recordingResponse().response,
    );

    expect(body).toMatchObject({
      year: 2025,
      dataAsOf: null,
      points: [],
      series: [],
    });
  });
});
