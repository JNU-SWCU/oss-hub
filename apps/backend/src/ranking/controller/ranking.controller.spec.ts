import { HEADERS_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import type { AuthConfig } from '../../auth/auth.config';
import { sessionCookieName } from '../../auth/cookies';
import { issueSessionToken } from '../../auth/session-token';
import { RANKING_VIEWER_TIERS, RANKING_YEAR_ALL } from '../domain/ranking';
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
  const resolveViewerTier = jest.fn();
  const controller = new RankingController(
    {
      findPage,
      listYears,
      resolveViewerTier,
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
    resolveViewerTier.mockReset();
    resolveViewerTier.mockResolvedValue(RANKING_VIEWER_TIERS.PUBLIC);
  });

  it('공개 랭킹과 연도 목록은 공개 회수 전 응답을 저장하지 않는다', () => {
    for (const methodName of ['findPage', 'listYears'] as const) {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        RankingController.prototype,
        methodName,
      )?.value;
      if (typeof handler !== 'function') {
        throw new TypeError(`RankingController.${methodName} is missing`);
      }
      expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual([
        { name: 'Cache-Control', value: 'no-store' },
      ]);
    }
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
    });

    await expect(
      controller.findPage(
        { year: '2026', page: 1, pageSize: 20 },
        requestWithCookie(),
        recordingResponse().response,
      ),
    ).resolves.toEqual({
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
    });
    expect(findPage).toHaveBeenCalledWith(
      2026,
      1,
      20,
      RANKING_VIEWER_TIERS.PUBLIC,
    );
  });

  it('쿠키가 없으면 세션을 묻지 않고 공개 계층으로 조회한다', async () => {
    findPage.mockResolvedValue(emptyPage);
    const { response, headers } = recordingResponse();

    await controller.findPage(
      { year: '2026', page: 1, pageSize: 20 },
      requestWithCookie(),
      response,
    );

    expect(resolveViewerTier).toHaveBeenCalledWith(null);
    expect(findPage).toHaveBeenCalledWith(
      2026,
      1,
      20,
      RANKING_VIEWER_TIERS.PUBLIC,
    );
    // 비로그인 응답은 데코레이터의 `no-store` 그대로다 — 덮어쓰지 않는다.
    expect(headers.has('Cache-Control')).toBe(false);
  });

  it('세션 쿠키가 유효하면 그 githubId로 계층을 묻는다', async () => {
    findPage.mockResolvedValue(emptyPage);
    resolveViewerTier.mockResolvedValue(RANKING_VIEWER_TIERS.PUBLIC);

    await controller.findPage(
      { year: '2026', page: 1, pageSize: 20 },
      requestWithCookie(await sessionCookie(4242n)),
      recordingResponse().response,
    );

    expect(resolveViewerTier).toHaveBeenCalledWith(4242n);
  });

  it('무효한 세션 쿠키는 401이 아니라 공개 계층이다', async () => {
    findPage.mockResolvedValue(emptyPage);

    await expect(
      controller.findPage(
        { year: '2026', page: 1, pageSize: 20 },
        requestWithCookie(`${sessionCookieName(false)}=tampered.token.value`),
        recordingResponse().response,
      ),
    ).resolves.toBeDefined();
    expect(resolveViewerTier).toHaveBeenCalledWith(null);
  });

  it('교직원·관리자 계층 응답은 private, no-store 로 내려간다', async () => {
    findPage.mockResolvedValue(emptyPage);
    resolveViewerTier.mockResolvedValue(RANKING_VIEWER_TIERS.STAFF);
    const { response, headers } = recordingResponse();

    await controller.findPage(
      { year: '2026', page: 1, pageSize: 20 },
      requestWithCookie(await sessionCookie(99n)),
      response,
    );

    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(findPage).toHaveBeenCalledWith(
      2026,
      1,
      20,
      RANKING_VIEWER_TIERS.STAFF,
    );
  });

  it('year 기본은 올해이고 legacy period=ALL 은 전체로 남는다', async () => {
    findPage.mockResolvedValue({
      year: RANKING_YEAR_ALL,
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      dataAsOf: null,
    });

    await controller.findPage(
      { page: 1, pageSize: 20 },
      requestWithCookie(),
      recordingResponse().response,
    );
    // 기본은 올해다(ADR-010 §1) — 명시적 ALL 만 전체 누적으로 간다.
    expect(findPage).toHaveBeenLastCalledWith(
      new Date().getFullYear(),
      1,
      20,
      RANKING_VIEWER_TIERS.PUBLIC,
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
      expect(findPage).toHaveBeenLastCalledWith(
        2026,
        1,
        20,
        RANKING_VIEWER_TIERS.PUBLIC,
      );
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
