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

  const SERIES = [
    { githubLogin: 'alpha', ranks: [1, 1], totals: [5, 100] },
    { githubLogin: 'bravo', ranks: [null, 2], totals: [null, 50] },
  ];
  const POINTS = [
    { date: '2026-01-31', starEstimated: true },
    { date: '2026-10-31', starEstimated: false },
  ];

  function timeline(
    viewerClass: RankingTimeline['viewerClass'],
    viewerGithubLogin: string | null,
  ): RankingTimeline {
    return {
      year: 2026,
      viewerClass,
      viewerGithubLogin,
      dataAsOf: new Date('2026-10-31T02:00:00.000Z'),
      points: POINTS,
      series: SERIES,
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

  it.each([
    ['public', null, null, 'no-store', null],
    ['member', 4242n, 'mina', 'private, no-store', 'Cookie'],
    ['staff', 4242n, 'mina', 'private, no-store', 'Cookie'],
  ] as const)(
    '%s 응답은 totals 와 열람자 로그인을 싣고 캐시 헤더를 계층에 맞춘다',
    async (viewerClass, githubId, viewerGithubLogin, cacheControl, vary) => {
      findTimeline.mockResolvedValue(timeline(viewerClass, viewerGithubLogin));
      const { response, headers } = recordingResponse();

      const body = await controller.findTimeline(
        { year: '2026' },
        requestWithAuth(githubId),
        response,
      );

      expect(body.series).toEqual(SERIES);
      expect(body.viewerGithubLogin).toBe(viewerGithubLogin);
      expect(headers.get('Cache-Control')).toBe(cacheControl);
      expect(headers.get('Vary') ?? null).toBe(vary);
      expect(findTimeline).toHaveBeenCalledWith(2026, githubId);
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
});
