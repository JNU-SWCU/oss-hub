import { Logger } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientError,
} from '../collection-discovery.client';
import { CollectionUserActivityService } from './collection-user-activity.service';

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (resolvePromise === undefined || rejectPromise === undefined) {
    throw new TypeError('Promise executor did not initialize');
  }
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

describe('CollectionUserActivityService', () => {
  const findMany = jest.fn();
  const findUnique = jest.fn();
  const upsert = jest.fn();
  const fetchUserActivityMetrics = jest.fn();

  // 2026-08-19 09:00 KST — Asia/Seoul 기준 연도는 2026이다.
  const now = () => new Date('2026-08-19T00:00:00.000Z');

  const buildService = (): CollectionUserActivityService =>
    new CollectionUserActivityService(
      {
        user: { findMany },
        githubUserActivityHistory: { findUnique, upsert },
      } as unknown as PrismaService,
      { fetchUserActivityMetrics } as unknown as CollectionDiscoveryClient,
      now,
    );

  const metrics = (commitCount: number) => ({
    commitCount,
    pullRequestCount: 2,
    issueCount: 3,
    repositoryCount: 4,
    starCount: 5,
  });

  beforeEach(() => {
    findMany.mockReset();
    findUnique.mockReset();
    findUnique.mockResolvedValue(null);
    upsert.mockReset();
    upsert.mockResolvedValue(undefined);
    fetchUserActivityMetrics.mockReset();
  });

  it('ACTIVE 가입 유저만 대상으로 조회하고 동의 테이블은 읽지 않는다', async () => {
    findMany.mockResolvedValue([]);

    await buildService().run();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountStatus: AccountStatus.ACTIVE },
        select: { githubId: true, nickname: true },
      }),
    );
  });

  it('nickname(=login)으로 Asia/Seoul 연도 창을 잡아 GraphQL을 부르고 전량 재계산 upsert한다', async () => {
    findMany.mockResolvedValue([{ githubId: 4242n, nickname: 'octocat' }]);
    fetchUserActivityMetrics.mockResolvedValue(metrics(10));

    const result = await buildService().run();

    // 2026 KST 연초 = 2025-12-31T15:00:00Z, 상한은 "지금" — 1년을 넘지 않는다.
    expect(fetchUserActivityMetrics).toHaveBeenCalledWith(
      'octocat',
      '2025-12-31T15:00:00.000Z',
      '2026-08-19T00:00:00.000Z',
    );
    expect(upsert).toHaveBeenCalledWith({
      where: { githubId_year: { githubId: 4242n, year: 2026 } },
      create: expect.objectContaining({
        githubId: 4242n,
        year: 2026,
        githubLogin: 'octocat',
        commitCount: 10,
        pullRequestCount: 2,
        issueCount: 3,
        repositoryCount: 4,
        starCount: 5,
      }) as unknown,
      update: expect.objectContaining({
        githubLogin: 'octocat',
        commitCount: 10,
        starCount: 5,
      }) as unknown,
    });
    expect(result).toEqual({
      observedUserCount: 1,
      upsertedRowCount: 1,
      skippedPastYearCount: 0,
      failedUserCount: 0,
    });
  });

  it('올해 행은 이미 있어도 다시 관측한다', async () => {
    findMany.mockResolvedValue([{ githubId: 4242n, nickname: 'octocat' }]);
    findUnique.mockResolvedValue({ githubId: 4242n });
    fetchUserActivityMetrics.mockResolvedValue(metrics(10));

    const result = await buildService().run([2026]);

    expect(fetchUserActivityMetrics).toHaveBeenCalledTimes(1);
    expect(result.skippedPastYearCount).toBe(0);
  });

  it('과거 연도는 행이 이미 있으면 GraphQL을 부르지 않는다', async () => {
    findMany.mockResolvedValue([{ githubId: 4242n, nickname: 'octocat' }]);
    findUnique.mockResolvedValue({ githubId: 4242n });

    const result = await buildService().run([2025]);

    expect(fetchUserActivityMetrics).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(result.skippedPastYearCount).toBe(1);
  });

  it('과거 연도 행이 없으면 그 해 경계로 잘라 관측한다', async () => {
    findMany.mockResolvedValue([{ githubId: 4242n, nickname: 'octocat' }]);
    fetchUserActivityMetrics.mockResolvedValue(metrics(7));

    await buildService().run([2025]);

    expect(fetchUserActivityMetrics).toHaveBeenCalledWith(
      'octocat',
      '2024-12-31T15:00:00.000Z',
      '2025-12-31T15:00:00.000Z',
    );
  });

  it('한 명이 실패해도 나머지를 계속 순회하고 실패 수만 집계한다', async () => {
    findMany.mockResolvedValue([
      { githubId: 1n, nickname: 'alpha' },
      { githubId: 2n, nickname: 'bravo' },
      { githubId: 3n, nickname: 'charlie' },
    ]);
    fetchUserActivityMetrics
      .mockResolvedValueOnce(metrics(1))
      .mockRejectedValueOnce(
        new CollectionDiscoveryClientError('RATE_LIMITED', 30),
      )
      .mockResolvedValueOnce(metrics(3));

    const result = await buildService().run();

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      observedUserCount: 3,
      upsertedRowCount: 2,
      skippedPastYearCount: 0,
      failedUserCount: 1,
    });
  });

  it('동시 run 두 개는 진행 중인 provider 실행과 같은 결과 객체를 공유한다', async () => {
    const provider = deferred<ReturnType<typeof metrics>>();
    const providerStarted = deferred<void>();
    findMany.mockResolvedValue([{ githubId: 4242n, nickname: 'octocat' }]);
    fetchUserActivityMetrics.mockImplementation(() => {
      providerStarted.resolve(undefined);
      return provider.promise;
    });
    const service = buildService();

    const firstRun = service.run();
    await providerStarted.promise;
    const secondRun = service.run();
    provider.resolve(metrics(10));
    const [firstResult, secondResult] = await Promise.all([
      firstRun,
      secondRun,
    ]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(fetchUserActivityMetrics).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(firstResult).toBe(secondResult);
  });

  it('공유 provider 실패가 끝나면 flight를 비워 다음 run을 새로 실행한다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const provider = deferred<ReturnType<typeof metrics>>();
    const providerStarted = deferred<void>();
    findMany.mockResolvedValue([{ githubId: 4242n, nickname: 'octocat' }]);
    fetchUserActivityMetrics
      .mockImplementationOnce(() => {
        providerStarted.resolve(undefined);
        return provider.promise;
      })
      .mockResolvedValue(metrics(11));
    const service = buildService();

    try {
      const firstRun = service.run();
      await providerStarted.promise;
      const secondRun = service.run();
      provider.reject(new CollectionDiscoveryClientError('RATE_LIMITED', 30));
      const [firstResult, secondResult] = await Promise.all([
        firstRun,
        secondRun,
      ]);
      const recoveryResult = await service.run();

      expect(firstResult).toBe(secondResult);
      expect(firstResult).toEqual({
        observedUserCount: 1,
        upsertedRowCount: 0,
        skippedPastYearCount: 0,
        failedUserCount: 1,
      });
      expect(recoveryResult).toEqual({
        observedUserCount: 1,
        upsertedRowCount: 1,
        skippedPastYearCount: 0,
        failedUserCount: 0,
      });
      expect(findMany).toHaveBeenCalledTimes(2);
      expect(fetchUserActivityMetrics).toHaveBeenCalledTimes(2);
      expect(upsert).toHaveBeenCalledTimes(1);
    } finally {
      logger.mockRestore();
    }
  });

  it('실패 로그에 토큰·저장소 이름·login을 담지 않고 분류만 남긴다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    findMany.mockResolvedValue([{ githubId: 1n, nickname: 'alpha' }]);
    fetchUserActivityMetrics.mockRejectedValue(
      Object.assign(new Error('boom'), {
        token: 'must-not-be-logged',
        nameWithOwner: 'JNU-SWCU/secret-repo',
      }),
    );

    await buildService().run();

    const serialized = JSON.stringify(logger.mock.calls);
    expect(serialized).not.toContain('must-not-be-logged');
    expect(serialized).not.toContain('secret-repo');
    expect(serialized).not.toContain('alpha');
    expect(logger).toHaveBeenCalledWith({
      event: 'collection.user_activity.user_failed',
      year: 2026,
      kind: 'UNKNOWN',
    });
    logger.mockRestore();
  });

  it('Contribution 저장소 축에는 아무것도 쓰지 않는다', async () => {
    const contribution = { create: jest.fn(), upsert: jest.fn() };
    const service = new CollectionUserActivityService(
      {
        user: { findMany },
        githubUserActivityHistory: { findUnique, upsert },
        contribution,
      } as unknown as PrismaService,
      { fetchUserActivityMetrics } as unknown as CollectionDiscoveryClient,
      now,
    );
    findMany.mockResolvedValue([{ githubId: 4242n, nickname: 'octocat' }]);
    fetchUserActivityMetrics.mockResolvedValue(metrics(10));

    await service.run();

    expect(contribution.create).not.toHaveBeenCalled();
    expect(contribution.upsert).not.toHaveBeenCalled();
  });
});
