import { BadRequestException, ConflictException, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientError,
  type CollectionMonthlyContributionResult,
  type CollectionMonthlyContributionWindow,
} from '../gateway/collection-discovery.client';
import { CollectionUserActivityRepository } from '../repository/collection-user-activity.repository';
import { CollectionSnapshotBackfillService } from './collection-snapshot-backfill.service';

interface SnapshotFindFirstArgs {
  readonly where: { readonly githubId?: bigint; readonly year: number };
}

interface SnapshotFindManyArgs {
  readonly where: { readonly githubId: bigint; readonly year: number };
}

interface SnapshotCreateManyArgs {
  readonly data: readonly {
    readonly githubId: bigint;
    readonly snapshotDate: Date;
    readonly year: number;
    readonly githubLogin: string;
    readonly commitCount: number;
    readonly pullRequestCount: number;
    readonly issueCount: number;
    readonly repositoryCount: number;
    readonly starCount: number;
    readonly starEstimated: boolean;
    readonly source: string;
    readonly observedAt: Date;
  }[];
  readonly skipDuplicates: boolean;
}

type SnapshotCreateRow = SnapshotCreateManyArgs['data'][number];

interface SweepSnapshot {
  readonly snapshotDate: Date;
  readonly starCount: number;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) {
    throw new TypeError('Promise executor did not initialize');
  }
  return { promise, resolve: resolvePromise };
}

const NOW = new Date('2026-10-31T03:00:00.000Z');
const YEAR = 2026;
const ALPHA = 1n;
const BRAVO = 2n;
const CHARLIE = 3n;
const BACKFILLED_MONTH_COUNT = 9;
const MONTHS_PER_YEAR = 12;

const monthEnd = (month: number): Date => new Date(Date.UTC(YEAR, month, 0));

const monthlyResult = (
  windows: readonly CollectionMonthlyContributionWindow[],
  remaining = 4_000,
): CollectionMonthlyContributionResult => ({
  months: windows.map((month) => ({
    alias: month.alias,
    commitCount: Number(month.alias.slice(1)),
    pullRequestCount: 2,
    issueCount: 3,
    repositoryCount: 4,
  })),
  remaining,
});

describe('CollectionSnapshotBackfillService', () => {
  const findMany = jest.fn<
    Promise<{ githubId: bigint; nickname: string }[]>,
    []
  >();
  const snapshotFindFirst = jest.fn<
    Promise<SweepSnapshot | null>,
    [SnapshotFindFirstArgs]
  >();
  const snapshotFindMany = jest.fn<
    Promise<{ snapshotDate: Date }[]>,
    [SnapshotFindManyArgs]
  >();
  const snapshotCreateMany = jest.fn<
    Promise<{ count: number }>,
    [SnapshotCreateManyArgs]
  >();
  const historyFindUnique = jest.fn();
  const historyUpsert = jest.fn();
  const fetchUserMonthlyContributionCounts = jest.fn<
    Promise<CollectionMonthlyContributionResult>,
    [string, readonly CollectionMonthlyContributionWindow[]]
  >();

  const sweepSnapshots = new Map<bigint, SweepSnapshot>();
  const existingSnapshotDates = new Map<bigint, Date[]>();
  const createdRows: SnapshotCreateRow[] = [];

  const buildService = (
    clock: () => Date = () => NOW,
  ): CollectionSnapshotBackfillService =>
    new CollectionSnapshotBackfillService(
      new CollectionUserActivityRepository({
        user: { findMany },
        githubUserActivityHistory: {
          findUnique: historyFindUnique,
          upsert: historyUpsert,
        },
        githubUserActivitySnapshot: {
          findFirst: snapshotFindFirst,
          findMany: snapshotFindMany,
          createMany: snapshotCreateMany,
        },
      } as unknown as PrismaService),
      {
        fetchUserMonthlyContributionCounts,
      } as unknown as CollectionDiscoveryClient,
      clock,
    );

  beforeEach(() => {
    sweepSnapshots.clear();
    existingSnapshotDates.clear();
    createdRows.length = 0;

    findMany.mockReset();
    findMany.mockResolvedValue([{ githubId: ALPHA, nickname: 'alpha' }]);
    historyFindUnique.mockReset();
    historyFindUnique.mockResolvedValue({ starCount: 999 });
    historyUpsert.mockReset();

    snapshotFindFirst.mockReset();
    snapshotFindFirst.mockImplementation((args) =>
      Promise.resolve(
        args.where.githubId === undefined
          ? ([...sweepSnapshots.values()][0] ?? null)
          : (sweepSnapshots.get(args.where.githubId) ?? null),
      ),
    );
    snapshotFindMany.mockReset();
    snapshotFindMany.mockImplementation((args) =>
      Promise.resolve(
        (existingSnapshotDates.get(args.where.githubId) ?? []).map(
          (snapshotDate) => ({ snapshotDate }),
        ),
      ),
    );
    snapshotCreateMany.mockReset();
    snapshotCreateMany.mockImplementation((args) => {
      createdRows.push(...args.data);
      return Promise.resolve({ count: args.data.length });
    });

    fetchUserMonthlyContributionCounts.mockReset();
    fetchUserMonthlyContributionCounts.mockImplementation((_login, windows) =>
      Promise.resolve(monthlyResult(windows)),
    );
  });

  it('학생 한 명당 한 번의 요청으로 1월부터 지난달까지의 누적 창을 보낸다', async () => {
    sweepSnapshots.set(ALPHA, {
      snapshotDate: new Date(Date.UTC(2026, 9, 31)),
      starCount: 42,
    });

    const result = await buildService().run(YEAR);

    expect(fetchUserMonthlyContributionCounts).toHaveBeenCalledTimes(1);
    const [login, windows] = fetchUserMonthlyContributionCounts.mock
      .calls[0] ?? ['', []];
    expect(login).toBe('alpha');
    expect(windows.map((month) => month.alias)).toEqual([
      'm01',
      'm02',
      'm03',
      'm04',
      'm05',
      'm06',
      'm07',
      'm08',
      'm09',
    ]);
    expect(windows[0]).toEqual({
      alias: 'm01',
      from: '2025-12-31T15:00:00.000Z',
      to: '2026-01-31T15:00:00.000Z',
    });
    expect(windows[8]).toEqual({
      alias: 'm09',
      from: '2025-12-31T15:00:00.000Z',
      to: '2026-09-30T15:00:00.000Z',
    });
    expect(result).toEqual({
      observedUserCount: 1,
      requestCount: 1,
      writtenRowCount: BACKFILLED_MONTH_COUNT,
      skippedExistingCount: 0,
      skippedStaleCount: 0,
      failedUserCount: 0,
      stoppedForBudget: false,
    });
  });

  it('BACKFILL 행은 추정 별 수로 최신 SWEEP 스냅샷 값을 쓰고 연도 행은 읽지 않는다', async () => {
    sweepSnapshots.set(ALPHA, {
      snapshotDate: new Date(Date.UTC(2026, 9, 31)),
      starCount: 42,
    });

    await buildService().run(YEAR);

    expect(createdRows).toHaveLength(BACKFILLED_MONTH_COUNT);
    expect(createdRows[0]).toEqual({
      githubId: ALPHA,
      snapshotDate: monthEnd(1),
      year: YEAR,
      githubLogin: 'alpha',
      commitCount: 1,
      pullRequestCount: 2,
      issueCount: 3,
      repositoryCount: 4,
      starCount: 42,
      starEstimated: true,
      source: 'BACKFILL',
      observedAt: NOW,
    });
    expect(createdRows.map((row) => row.snapshotDate)).toEqual([
      monthEnd(1),
      monthEnd(2),
      monthEnd(3),
      monthEnd(4),
      monthEnd(5),
      monthEnd(6),
      monthEnd(7),
      monthEnd(8),
      monthEnd(9),
    ]);
    expect(createdRows.map((row) => row.commitCount)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(
      createdRows.every(
        (row) => row.source === 'BACKFILL' && row.starEstimated,
      ),
    ).toBe(true);
    expect(createdRows.every((row) => row.starCount === 42)).toBe(true);
    expect(snapshotCreateMany.mock.calls[0]?.[0].skipDuplicates).toBe(true);
    expect(historyFindUnique).not.toHaveBeenCalled();
    expect(historyUpsert).not.toHaveBeenCalled();
  });

  it('이미 모든 달의 스냅샷이 있으면 요청도 쓰기도 하지 않는다', async () => {
    sweepSnapshots.set(ALPHA, {
      snapshotDate: new Date(Date.UTC(2026, 9, 31)),
      starCount: 42,
    });
    existingSnapshotDates.set(
      ALPHA,
      Array.from({ length: BACKFILLED_MONTH_COUNT }, (_unused, index) =>
        monthEnd(index + 1),
      ),
    );

    const result = await buildService().run(YEAR);

    expect(fetchUserMonthlyContributionCounts).not.toHaveBeenCalled();
    expect(snapshotCreateMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      observedUserCount: 1,
      requestCount: 0,
      writtenRowCount: 0,
      skippedExistingCount: BACKFILLED_MONTH_COUNT,
      skippedStaleCount: 0,
      failedUserCount: 0,
      stoppedForBudget: false,
    });
  });

  it('이미 있는 달만 건너뛰고 남은 달을 한 번의 요청으로 채운다', async () => {
    sweepSnapshots.set(ALPHA, {
      snapshotDate: new Date(Date.UTC(2026, 9, 31)),
      starCount: 42,
    });
    existingSnapshotDates.set(ALPHA, [monthEnd(1)]);

    const result = await buildService().run(YEAR);

    expect(fetchUserMonthlyContributionCounts).toHaveBeenCalledTimes(1);
    expect(
      (fetchUserMonthlyContributionCounts.mock.calls[0]?.[1] ?? []).map(
        (month) => month.alias,
      ),
    ).toEqual(['m02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09']);
    expect(createdRows.map((row) => row.snapshotDate)).not.toContainEqual(
      monthEnd(1),
    );
    expect(result).toEqual(
      expect.objectContaining({
        requestCount: 1,
        writtenRowCount: BACKFILLED_MONTH_COUNT - 1,
        skippedExistingCount: 1,
      }),
    );
  });

  it('남은 포인트가 500 미만이면 멈추고 다음 학생은 건드리지 않는다', async () => {
    findMany.mockResolvedValue([
      { githubId: ALPHA, nickname: 'alpha' },
      { githubId: BRAVO, nickname: 'bravo' },
      { githubId: CHARLIE, nickname: 'charlie' },
    ]);
    for (const githubId of [ALPHA, BRAVO, CHARLIE]) {
      sweepSnapshots.set(githubId, {
        snapshotDate: new Date(Date.UTC(2026, 9, 31)),
        starCount: 42,
      });
    }
    fetchUserMonthlyContributionCounts.mockImplementation((_login, windows) =>
      Promise.resolve(monthlyResult(windows, 499)),
    );

    const result = await buildService().run(YEAR);

    expect(fetchUserMonthlyContributionCounts).toHaveBeenCalledTimes(1);
    expect(new Set(createdRows.map((row) => row.githubId))).toEqual(
      new Set([ALPHA]),
    );
    expect(result).toEqual({
      observedUserCount: 1,
      requestCount: 1,
      writtenRowCount: BACKFILLED_MONTH_COUNT,
      skippedExistingCount: 0,
      skippedStaleCount: 0,
      failedUserCount: 0,
      stoppedForBudget: true,
    });
  });

  it('GitHub 요청 뒤 쓰기가 실패해도 보낸 요청은 집계에 남는다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    sweepSnapshots.set(ALPHA, {
      snapshotDate: new Date(Date.UTC(2026, 9, 31)),
      starCount: 42,
    });
    snapshotCreateMany.mockRejectedValue(new Error('snapshot write failed'));

    try {
      const result = await buildService().run(YEAR);

      expect(fetchUserMonthlyContributionCounts).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        observedUserCount: 1,
        requestCount: 1,
        writtenRowCount: 0,
        skippedExistingCount: 0,
        skippedStaleCount: 0,
        failedUserCount: 1,
        stoppedForBudget: false,
      });
    } finally {
      logger.mockRestore();
    }
  });

  it.each([2025, 2027])(
    '%s 연도는 거부하고 아무것도 읽지 않는다',
    async (year) => {
      sweepSnapshots.set(ALPHA, {
        snapshotDate: new Date(Date.UTC(2026, 9, 31)),
        starCount: 42,
      });

      await expect(buildService().run(year)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(findMany).not.toHaveBeenCalled();
      expect(fetchUserMonthlyContributionCounts).not.toHaveBeenCalled();
      expect(snapshotCreateMany).not.toHaveBeenCalled();
    },
  );

  it('그 해 SWEEP 스냅샷이 하나도 없으면 409로 거부한다', async () => {
    const result = buildService().run(YEAR);

    await expect(result).rejects.toBeInstanceOf(ConflictException);
    expect(fetchUserMonthlyContributionCounts).not.toHaveBeenCalled();
    expect(snapshotCreateMany).not.toHaveBeenCalled();
  });

  it('assertReady는 SWEEP 스냅샷이 없으면 409로 거부하고 있으면 통과시킨다', async () => {
    const service = buildService();

    await expect(service.assertReady(YEAR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(findMany).not.toHaveBeenCalled();

    sweepSnapshots.set(ALPHA, {
      snapshotDate: new Date(Date.UTC(2026, 9, 31)),
      starCount: 42,
    });

    await expect(service.assertReady(YEAR)).resolves.toBeUndefined();
    expect(fetchUserMonthlyContributionCounts).not.toHaveBeenCalled();
    expect(snapshotCreateMany).not.toHaveBeenCalled();
  });

  it('SWEEP 스냅샷이 없는 학생은 요청도 행도 없이 건너뛰고, 갱신된 뒤 재실행에서 채운다', async () => {
    findMany.mockResolvedValue([
      { githubId: ALPHA, nickname: 'alpha' },
      { githubId: BRAVO, nickname: 'bravo' },
    ]);
    sweepSnapshots.set(ALPHA, {
      snapshotDate: new Date(Date.UTC(2026, 9, 31)),
      starCount: 42,
    });
    const service = buildService();

    const first = await service.run(YEAR);

    expect(first).toEqual({
      observedUserCount: 2,
      requestCount: 1,
      writtenRowCount: BACKFILLED_MONTH_COUNT,
      skippedExistingCount: 0,
      skippedStaleCount: 1,
      failedUserCount: 0,
      stoppedForBudget: false,
    });
    expect(createdRows.every((row) => row.githubId === ALPHA)).toBe(true);
    expect(
      fetchUserMonthlyContributionCounts.mock.calls.map(([login]) => login),
    ).toEqual(['alpha']);

    existingSnapshotDates.set(
      ALPHA,
      Array.from({ length: BACKFILLED_MONTH_COUNT }, (_unused, index) =>
        monthEnd(index + 1),
      ),
    );
    sweepSnapshots.set(BRAVO, {
      snapshotDate: new Date(Date.UTC(2026, 9, 31)),
      starCount: 7,
    });
    createdRows.length = 0;

    const second = await service.run(YEAR);

    expect(second).toEqual({
      observedUserCount: 2,
      requestCount: 1,
      writtenRowCount: BACKFILLED_MONTH_COUNT,
      skippedExistingCount: BACKFILLED_MONTH_COUNT,
      skippedStaleCount: 0,
      failedUserCount: 0,
      stoppedForBudget: false,
    });
    expect(createdRows).toHaveLength(BACKFILLED_MONTH_COUNT);
    expect(createdRows.every((row) => row.githubId === BRAVO)).toBe(true);
    expect(createdRows.every((row) => row.starCount === 7)).toBe(true);
    expect(
      fetchUserMonthlyContributionCounts.mock.calls.map(([login]) => login),
    ).toEqual(['alpha', 'bravo']);
  });

  it('한 학생이 실패해도 나머지를 채우고 분류만 로그에 남긴다', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    findMany.mockResolvedValue([
      { githubId: ALPHA, nickname: 'alpha' },
      { githubId: BRAVO, nickname: 'bravo' },
    ]);
    for (const githubId of [ALPHA, BRAVO]) {
      sweepSnapshots.set(githubId, {
        snapshotDate: new Date(Date.UTC(2026, 9, 31)),
        starCount: 42,
      });
    }
    fetchUserMonthlyContributionCounts.mockImplementation((login, windows) =>
      login === 'alpha'
        ? Promise.reject(new CollectionDiscoveryClientError('RATE_LIMITED', 30))
        : Promise.resolve(monthlyResult(windows)),
    );

    try {
      const result = await buildService().run(YEAR);

      expect(result).toEqual(
        expect.objectContaining({
          requestCount: 2,
          writtenRowCount: BACKFILLED_MONTH_COUNT,
          failedUserCount: 1,
        }),
      );
      expect(createdRows.every((row) => row.githubId === BRAVO)).toBe(true);
      expect(logger).toHaveBeenCalledWith({
        event: 'collection.snapshot_backfill.user_failed',
        year: YEAR,
        kind: 'RATE_LIMITED',
      });
      expect(JSON.stringify(logger.mock.calls)).not.toContain('alpha');
    } finally {
      logger.mockRestore();
    }
  });

  it('진행 중인 실행에 겹친 run은 같은 promise를 돌려준다', async () => {
    sweepSnapshots.set(ALPHA, {
      snapshotDate: new Date(Date.UTC(2026, 9, 31)),
      starCount: 42,
    });
    const provider = deferred<CollectionMonthlyContributionResult>();
    const providerStarted = deferred<void>();
    let requestedWindows: readonly CollectionMonthlyContributionWindow[] = [];
    fetchUserMonthlyContributionCounts.mockImplementation((_login, windows) => {
      requestedWindows = windows;
      providerStarted.resolve(undefined);
      return provider.promise;
    });
    const service = buildService();

    const firstRun = service.run(YEAR);
    await providerStarted.promise;
    const secondRun = service.run(YEAR);
    provider.resolve(monthlyResult(requestedWindows));
    const [firstResult, secondResult] = await Promise.all([
      firstRun,
      secondRun,
    ]);

    expect(firstRun).toBe(secondRun);
    expect(firstResult).toBe(secondResult);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(fetchUserMonthlyContributionCounts).toHaveBeenCalledTimes(1);
    expect(snapshotCreateMany).toHaveBeenCalledTimes(1);
  });

  it('다른 연도의 run은 진행 중인 실행과 합쳐지지 않고 따로 돌고, 같은 연도만 공유한다', async () => {
    sweepSnapshots.set(ALPHA, {
      snapshotDate: new Date(Date.UTC(2026, 9, 31)),
      starCount: 42,
    });
    const pending: {
      readonly windows: readonly CollectionMonthlyContributionWindow[];
      readonly resolve: (value: CollectionMonthlyContributionResult) => void;
    }[] = [];
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    fetchUserMonthlyContributionCounts.mockImplementation(
      (_login, windows) => {
        const gate = deferred<CollectionMonthlyContributionResult>();
        pending.push({ windows, resolve: gate.resolve });
        (pending.length === 1 ? firstStarted : secondStarted).resolve(
          undefined,
        );
        return gate.promise;
      },
    );
    const service = buildService(() => new Date('2028-02-01T03:00:00.000Z'));

    const run2026 = service.run(2026);
    await firstStarted.promise;
    const run2027 = service.run(2027);
    await secondStarted.promise;

    expect(run2027).not.toBe(run2026);
    expect(service.run(2026)).toBe(run2026);
    for (const call of pending) {
      call.resolve(monthlyResult(call.windows));
    }
    const [result2026, result2027] = await Promise.all([run2026, run2027]);

    expect(result2026.requestCount).toBe(1);
    expect(result2027.requestCount).toBe(1);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(fetchUserMonthlyContributionCounts).toHaveBeenCalledTimes(2);
    expect(new Set(createdRows.map((row) => row.year))).toEqual(
      new Set([2026, 2027]),
    );
    expect(result2026.writtenRowCount).toBe(MONTHS_PER_YEAR);
    expect(result2027.writtenRowCount).toBe(MONTHS_PER_YEAR);
  });

  it('올해 1월에는 채울 달이 없어 요청하지 않는다', async () => {
    sweepSnapshots.set(ALPHA, {
      snapshotDate: new Date(Date.UTC(2026, 0, 5)),
      starCount: 42,
    });

    const result = await buildService(
      () => new Date('2026-01-15T03:00:00.000Z'),
    ).run(YEAR);

    expect(fetchUserMonthlyContributionCounts).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ requestCount: 0, writtenRowCount: 0 }),
    );
  });

  it('지난 연도는 12달 전체를 한 번에 채운다', async () => {
    sweepSnapshots.set(ALPHA, {
      snapshotDate: new Date(Date.UTC(2026, 9, 31)),
      starCount: 42,
    });

    const result = await buildService(
      () => new Date('2027-03-02T03:00:00.000Z'),
    ).run(YEAR);

    expect(
      (fetchUserMonthlyContributionCounts.mock.calls[0]?.[1] ?? []).map(
        (month) => month.alias,
      ),
    ).toEqual([
      'm01',
      'm02',
      'm03',
      'm04',
      'm05',
      'm06',
      'm07',
      'm08',
      'm09',
      'm10',
      'm11',
      'm12',
    ]);
    expect(createdRows.map((row) => row.snapshotDate)).toContainEqual(
      new Date(Date.UTC(2026, 11, 31)),
    );
    expect(result).toEqual(
      expect.objectContaining({ requestCount: 1, writtenRowCount: 12 }),
    );
  });
});
