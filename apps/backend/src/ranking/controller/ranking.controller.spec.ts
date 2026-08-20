import { HEADERS_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import type { AuthConfig } from '../../auth/auth.config';
import { sessionCookieName } from '../../auth/cookies';
import { issueSessionToken } from '../../auth/session-token';
import { RANKING_YEAR_ALL } from '../domain/ranking';
import { RankingController } from './ranking.controller';
import { RankingService } from '../service/ranking.service';

const sessionSecret = new Uint8Array(32).fill(11);
const config = {
  sessionSecret,
  useSecureCookies: false,
} as unknown as AuthConfig;

describe('RankingController', () => {
  const findPage = jest.fn();
  const listYears = jest.fn();
  const controller = new RankingController(
    {
      findPage,
      listYears,
    } as unknown as RankingService,
    config,
  );

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

  function requestWithCookie(cookie?: string): Request {
    return { headers: cookie === undefined ? {} : { cookie } } as Request;
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

  async function sessionCookie(githubId: bigint): Promise<string> {
    return `${sessionCookieName(false)}=${await issueSessionToken(
      sessionSecret,
      githubId,
    )}`;
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

  it('공개 API 계약 형태로 서비스 결과를 전달한다', async () => {
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
      requestWithCookie(),
      recordingResponse().response,
    );

    expect(body).toEqual({
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
    expect(body.items[0]).not.toHaveProperty('name');
    expect(findPage).toHaveBeenCalledWith(2026, 1, 20, null);
  });

  it('쿠키가 없으면 githubId null로 조회하고 public no-store를 내린다', async () => {
    findPage.mockResolvedValue(emptyPage);
    const { response, headers } = recordingResponse();

    await controller.findPage(
      { year: '2026', page: 1, pageSize: 20 },
      requestWithCookie(),
      response,
    );

    expect(findPage).toHaveBeenCalledWith(2026, 1, 20, null);
    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(headers.has('Vary')).toBe(false);
  });

  it('세션 쿠키가 유효하면 그 githubId를 findPage에 넘긴다', async () => {
    findPage.mockResolvedValue(emptyPage);

    await controller.findPage(
      { year: '2026', page: 1, pageSize: 20 },
      requestWithCookie(await sessionCookie(4242n)),
      recordingResponse().response,
    );

    expect(findPage).toHaveBeenCalledWith(2026, 1, 20, 4242n);
  });

  it('무효한 세션 쿠키는 401이 아니라 githubId null이다', async () => {
    findPage.mockResolvedValue(emptyPage);

    await expect(
      controller.findPage(
        { year: '2026', page: 1, pageSize: 20 },
        requestWithCookie(`${sessionCookieName(false)}=tampered.token.value`),
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
      requestWithCookie(await sessionCookie(99n)),
      response,
    );

    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('Vary')).toBe('Cookie');
    expect(findPage).toHaveBeenCalledWith(2026, 1, 20, 99n);
  });

  it('staff 항목의 name을 응답에 실어 보낸다', async () => {
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

    await expect(
      controller.findPage(
        { year: '2026', page: 1, pageSize: 20 },
        requestWithCookie(await sessionCookie(99n)),
        recordingResponse().response,
      ),
    ).resolves.toMatchObject({
      viewerClass: 'staff',
      nextCycleAt: '2026-08-20T01:00:00.000Z',
      items: [expect.objectContaining({ name: '미나', displayName: 'mina' })],
    });
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
      requestWithCookie(),
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
        requestWithCookie(),
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
