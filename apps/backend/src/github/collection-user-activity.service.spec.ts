import { Logger } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';

import { PrismaService } from '../platform/prisma.service';
import { CollectionDiscoveryClient } from './collection-discovery.client';
import { CollectionUserActivityRepository } from './repository-provision-job.repository';
import { CollectionUserActivityService } from './collection-user-activity.service';
import { CollectionDiscoveryClientError } from './collection-discovery.error';

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
  const queryRaw = jest.fn();
  const upsert = jest.fn();
  const monthlyUpsert = jest.fn();
  const executeRaw = jest.fn();
  const transactionQueryRaw = jest.fn();
  const fetchUserActivityMetrics = jest.fn();

  const now = () => new Date('2026-08-19T00:00:00.000Z');

  const buildService = (): CollectionUserActivityService =>
    new CollectionUserActivityService(
      new CollectionUserActivityRepository({
        user: { findMany },
        githubUserActivityHistory: { findUnique, upsert },
        githubUserActivityMonthly: { upsert: monthlyUpsert },
        $queryRaw: queryRaw,
        $transaction: (operation: (transaction: unknown) => Promise<unknown>) =>
          operation({
            githubUserActivityHistory: { findUnique, upsert },
            githubUserActivityMonthly: { upsert: monthlyUpsert },
            $executeRaw: executeRaw,
            $queryRaw: transactionQueryRaw,
          }),
      } as unknown as PrismaService),
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
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([{ present: false }]);
    upsert.mockReset();
    upsert.mockResolvedValue(undefined);
    monthlyUpsert.mockReset();
    monthlyUpsert.mockResolvedValue(undefined);
    executeRaw.mockReset();
    executeRaw.mockResolvedValue(1);
    transactionQueryRaw.mockReset();
    transactionQueryRaw.mockResolvedValue([]);
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

    expect(fetchUserActivityMetrics).toHaveBeenCalledWith(
      'octocat',
      '2025-12-31T15:00:00.000Z',
      '2026-08-19T00:00:00.000Z',
    );
    expect(upsert).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(2);
    const ledgerSql = (executeRaw.mock.calls[0] as readonly unknown[])[0];
    expect(Array.isArray(ledgerSql) ? ledgerSql.join('') : '').toContain(
      'INSERT INTO "github_user_activity_history"',
    );
    expect(monthlyUpsert).toHaveBeenCalledWith({
      where: {
        githubId_year_month: { githubId: 4242n, year: 2026, month: 8 },
      },
      create: expect.objectContaining({
        githubId: 4242n,
        year: 2026,
        month: 8,
        commitCount: 10,
        starCount: 5,
      }) as unknown,
      update: expect.objectContaining({ commitCount: 10 }) as unknown,
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
    queryRaw.mockResolvedValue([{ present: true }]);

    const result = await buildService().run([2025]);

    expect(fetchUserActivityMetrics).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(result.skippedPastYearCount).toBe(1);
    const call =
      (queryRaw.mock.calls as readonly (readonly unknown[])[])[0] ?? [];
    const strings = call[0];
    if (!Array.isArray(strings)) {
      throw new Error('Standing query was not recorded');
    }
    expect(strings.join('')).toContain("'PUBLIC'");
    expect(call.slice(1)).toEqual([4242n, 2025]);
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

    expect(upsert).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(4);
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
    expect(upsert).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(2);
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
      expect(upsert).not.toHaveBeenCalled();
      expect(executeRaw).toHaveBeenCalledTimes(2);
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
      new CollectionUserActivityRepository({
        user: { findMany },
        githubUserActivityHistory: { findUnique, upsert },
        contribution,
      } as unknown as PrismaService),
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

describe('CollectionUserActivityRepository ledger history', () => {
  const observedAt = new Date('2026-08-19T00:00:00.000Z');
  const counts = {
    commitCount: 10,
    pullRequestCount: 2,
    issueCount: 3,
    repositoryCount: 4,
    starCount: 5,
  };

  const sqlOf = (call: readonly unknown[]): string => {
    const strings = call[0];
    if (!Array.isArray(strings)) {
      throw new Error('ledger write was not a SQL template');
    }
    return strings.join('');
  };

  const expectOneLedgerStatement = (executeRaw: jest.Mock): void => {
    expect(executeRaw).toHaveBeenCalledTimes(2);
    const call = executeRaw.mock.calls[0] as readonly unknown[];
    const sql = sqlOf(call);
    expect(sql).toContain('INSERT INTO "github_user_activity_history"');
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).toContain('ORDER BY latest."observed_at" DESC');
    expect(sql).toContain(
      'ON CONFLICT ("github_id", "year", "visibility", "observed_at") DO UPDATE SET',
    );
    expect(sql).toContain('"commit_count" = EXCLUDED."commit_count"');
    expect(sql).toContain(
      '"pull_request_count" = EXCLUDED."pull_request_count"',
    );
    expect(sql).toContain('"issue_count" = EXCLUDED."issue_count"');
    expect(sql).toContain('"repository_count" = EXCLUDED."repository_count"');
    expect(sql).toContain('"star_count" = EXCLUDED."star_count"');
    expect(sql).not.toContain('INSERT INTO "repo"');
    expect(sql).not.toContain('team_repo');
  };

  const buildRepository = (): {
    readonly repository: CollectionUserActivityRepository;
    readonly historyUpsert: jest.Mock;
    readonly executeRaw: jest.Mock;
  } => {
    const historyUpsert = jest.fn().mockResolvedValue({});
    const executeRaw = jest.fn().mockResolvedValue(1);
    const transaction = {
      githubUserActivityHistory: {
        upsert: historyUpsert,
        findUnique: jest.fn().mockResolvedValue(null),
      },
      githubUserActivityMonthly: { upsert: jest.fn().mockResolvedValue({}) },
      $executeRaw: executeRaw,
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const db = {
      $transaction: (operation: (tx: typeof transaction) => Promise<void>) =>
        operation(transaction),
    };
    return {
      repository: new CollectionUserActivityRepository(
        db as unknown as PrismaService,
      ),
      historyUpsert,
      executeRaw,
    };
  };

  it('공개 관측은 옛 이력 upsert 없이 원장 한 문장과 월별 upsert를 보낸다', async () => {
    const { repository, historyUpsert, executeRaw } = buildRepository();

    await repository.upsertObservation({
      githubId: 4242n,
      year: 2026,
      month: 8,
      githubLogin: 'octocat',
      ...counts,
      observedAt,
    });

    expect(historyUpsert).not.toHaveBeenCalled();
    expectOneLedgerStatement(executeRaw);
    const values = (executeRaw.mock.calls[0] as readonly unknown[]).slice(1);
    expect(values).toEqual(
      expect.arrayContaining([4242n, 2026, 'PUBLIC', 10, 5, observedAt]),
    );
  });

  it('비공개 관측도 같은 원장 문장을 보내고 starCount는 0이다', async () => {
    const { repository, historyUpsert, executeRaw } = buildRepository();

    await repository.upsertPrivateObservation({
      githubId: 4242n,
      year: 2026,
      githubLogin: 'octocat',
      commitCount: counts.commitCount,
      pullRequestCount: counts.pullRequestCount,
      issueCount: counts.issueCount,
      repositoryCount: counts.repositoryCount,
      observedAt,
    });

    expect(historyUpsert).not.toHaveBeenCalled();
    expectOneLedgerStatement(executeRaw);
    const values = (executeRaw.mock.calls[0] as readonly unknown[]).slice(1);
    expect(values).toEqual(
      expect.arrayContaining([4242n, 'PRIVATE', 0, observedAt]),
    );
  });
});
