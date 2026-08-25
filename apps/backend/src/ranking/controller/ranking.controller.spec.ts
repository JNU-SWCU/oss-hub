import { HEADERS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import {
  HTTP_AUTH_KINDS,
  type OptionalSessionRequest,
} from '../../auth/http-auth';
import { RANKING_YEAR_ALL } from '../domain/ranking';
import { RankingController } from './ranking.controller';
import { RankingService } from '../service/ranking.service';

describe('RankingController', () => {
  const findPage = jest.fn();
  const listYears = jest.fn();
  const controller = new RankingController({
    findPage,
    listYears,
  } as unknown as RankingService);

  const emptyPage = {
    year: 2026,
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    dataAsOf: null,
    viewerClass: 'public' as const,
    nextCycleAt: null,
  };

  function requestWithAuth(
    githubId: bigint | null,
    cookie?: string,
  ): OptionalSessionRequest {
    return {
      headers: cookie === undefined ? {} : { cookie },
      auth:
        githubId === null
          ? {
              kind: HTTP_AUTH_KINDS.ANONYMOUS,
              hasSessionCookie: cookie !== undefined,
            }
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
    findPage.mockReset();
    listYears.mockReset();
  });

  it('listYears keeps static no-store; findPage does not set Cache-Control on the decorator', () => {
    const listYearsHandler: unknown = Object.getOwnPropertyDescriptor(
      RankingController.prototype,
      'listYears',
    )?.value;
    if (typeof listYearsHandler !== 'function') {
      throw new TypeError('RankingController.listYears is missing');
    }
    expect(Reflect.getMetadata(HEADERS_METADATA, listYearsHandler)).toEqual([
      { name: 'Cache-Control', value: 'no-store' },
    ]);

    const findPageHandler: unknown = Object.getOwnPropertyDescriptor(
      RankingController.prototype,
      'findPage',
    )?.value;
    if (typeof findPageHandler !== 'function') {
      throw new TypeError('RankingController.findPage is missing');
    }
    expect(
      Reflect.getMetadata(HEADERS_METADATA, findPageHandler),
    ).toBeUndefined();
  });

  it('public 항목은 허용된 네 키만 응답한다', async () => {
    findPage.mockResolvedValue({
      year: 2026,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          department: '소프트웨어공학과',
          commitCount: 2,
          pullRequestCount: 1,
          issueCount: 3,
          repositoryCount: 4,
          starCount: 5,
          total: 15,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      dataAsOf: null,
      viewerClass: 'public',
      nextCycleAt: null,
    });

    const body = await controller.findPage(
      { year: '2026', page: 1, pageSize: 20 },
      requestWithAuth(null),
      recordingResponse().response,
    );

    expect(body.items[0]).toEqual({
      rank: 1,
      githubLogin: 'mina',
      commitCount: 2,
      pullRequestCount: 1,
    });
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
      'commitCount',
      'githubLogin',
      'pullRequestCount',
      'rank',
    ]);
    for (const excluded of [
      'department',
      'displayName',
      'githubId',
      'id',
      'issueCount',
      'name',
      'repositoryCount',
      'starCount',
      'total',
      'userId',
    ]) {
      expect(body.items[0]).not.toHaveProperty(excluded);
    }
    expect(findPage).toHaveBeenCalledWith(2026, 1, 20, null);
  });

  it('anonymous auth metadata면 githubId null로 조회하고 public no-store를 내린다', async () => {
    findPage.mockResolvedValue(emptyPage);
    const { response, headers } = recordingResponse();

    await controller.findPage(
      { year: '2026', page: 1, pageSize: 20 },
      requestWithAuth(null),
      response,
    );

    expect(findPage).toHaveBeenCalledWith(2026, 1, 20, null);
    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(headers.has('Vary')).toBe(false);
  });

  it('guard가 붙인 principal githubId를 findPage에 넘긴다', async () => {
    findPage.mockResolvedValue(emptyPage);

    await controller.findPage(
      { year: '2026', page: 1, pageSize: 20 },
      requestWithAuth(4242n),
      recordingResponse().response,
    );

    expect(findPage).toHaveBeenCalledWith(2026, 1, 20, 4242n);
  });

  it('stale 쿠키가 있어도 anonymous auth metadata를 우회하지 못한다', async () => {
    findPage.mockResolvedValue(emptyPage);

    await expect(
      controller.findPage(
        { year: '2026', page: 1, pageSize: 20 },
        requestWithAuth(null, 'oss_hub_session=stale.token.value'),
        recordingResponse().response,
      ),
    ).resolves.toBeDefined();
    expect(findPage).toHaveBeenCalledWith(2026, 1, 20, null);
  });

  it('staff viewerClass는 private, no-store와 Vary Cookie를 내린다', async () => {
    findPage.mockResolvedValue({
      ...emptyPage,
      viewerClass: 'staff',
    });
    const { response, headers } = recordingResponse();

    await controller.findPage(
      { year: '2026', page: 1, pageSize: 20 },
      requestWithAuth(99n),
      response,
    );

    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('Vary')).toBe('Cookie');
    expect(findPage).toHaveBeenCalledWith(2026, 1, 20, 99n);
  });

  it('staff 항목은 실명과 전체 지표를 포함한 richer envelope을 유지한다', async () => {
    findPage.mockResolvedValue({
      year: 2026,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          department: '소프트웨어공학과',
          name: '미나',
          commitCount: 2,
          pullRequestCount: 1,
          issueCount: 3,
          repositoryCount: 4,
          starCount: 5,
          total: 15,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      dataAsOf: null,
      viewerClass: 'staff',
      nextCycleAt: new Date('2026-08-20T01:00:00.000Z'),
    });

    const body = await controller.findPage(
      { year: '2026', page: 1, pageSize: 20 },
      requestWithAuth(99n),
      recordingResponse().response,
    );

    expect(body.items[0]).toEqual({
      rank: 1,
      displayName: 'mina',
      githubLogin: 'mina',
      department: '소프트웨어공학과',
      name: '미나',
      commitCount: 2,
      pullRequestCount: 1,
      issueCount: 3,
      repositoryCount: 4,
      starCount: 5,
      total: 15,
    });
    expect(body.viewerClass).toBe('staff');
    expect(body.nextCycleAt).toBe('2026-08-20T01:00:00.000Z');
  });

  it('year 기본은 올해이고 legacy period=ALL 은 전체로 남는다', async () => {
    findPage.mockResolvedValue({
      year: RANKING_YEAR_ALL,
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      dataAsOf: null,
      viewerClass: 'public',
      nextCycleAt: null,
    });

    await controller.findPage(
      { page: 1, pageSize: 20 },
      requestWithAuth(null),
      recordingResponse().response,
    );
    expect(findPage).toHaveBeenLastCalledWith(
      new Date().getFullYear(),
      1,
      20,
      null,
    );

    findPage.mockResolvedValue(emptyPage);
    const now = new Date('2026-07-21T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(now);
    try {
      await controller.findPage(
        { period: 'THIS_YEAR', page: 1, pageSize: 20 },
        requestWithAuth(null),
        recordingResponse().response,
      );
      expect(findPage).toHaveBeenLastCalledWith(2026, 1, 20, null);
    } finally {
      jest.useRealTimers();
    }
  });

  it('GET /ranking/years 는 연도 목록을 전달한다', async () => {
    listYears.mockResolvedValue([2026, 2025]);

    await expect(controller.listYears()).resolves.toEqual({
      years: [2026, 2025],
    });
    expect(listYears).toHaveBeenCalledTimes(1);
  });
});
