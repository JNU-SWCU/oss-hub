import { CollectionReadService } from './collection-read.service';
import type { CollectionCanonicalRepository } from './collection-canonical.repository';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * todo 11 — `getRepositoryMetrics`/`getContributorMetrics`만 다룬다. `findRankingActivity`/
 * `getStatusSnapshot`은 이 todo에서 변경하지 않았고 별도 spec 커버리지도 요구하지 않는다
 * (old canonical rollback 참조 전용, `GithubRepository`를 읽지 않는다).
 * todo 12 — `getIncrementalStatusSnapshot`은 아래 별도 describe 블록에서 다룬다.
 * GR-13(`.omc/plans/github-repository-unification.md:496`) — `findRepositoryActivity`·
 * `getRepositoryMetrics`·`getContributorMetrics`·`getRepositoryCumulativeMetrics`·
 * `getContributorCumulativeMetrics`가 호출자의 `repositoryIds`를 `source: 'ORG_PROVISIONED'`
 * 로 가드하는지 각 describe 블록 끝의 "GR-13" 테스트가 검증한다. 이 테스트들은 mock
 * `findMany`가 실제 Prisma처럼 `where`를 보고 걸러내도록 구현해, 서비스 코드에서 그 필터를
 * 지우면 실제로 실패한다(단순 `where` 인자 스냅샷 비교가 아니다).
 */
interface MockPrisma {
  githubRepository: { findMany: jest.Mock; count: jest.Mock };
  collectionContributorYearAggregate: { findMany: jest.Mock };
  collectionRepositoryStream: {
    groupBy: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
  };
  collectionSyncCursor: { findFirst: jest.Mock };
}

const createDb = (): MockPrisma => ({
  githubRepository: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  collectionContributorYearAggregate: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  collectionRepositoryStream: {
    groupBy: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({
      _min: { lastRunAt: null, lastErrorAt: null },
      _max: { lastRunAt: null },
    }),
  },
  collectionSyncCursor: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
});

const serviceFor = (db: MockPrisma): CollectionReadService =>
  new CollectionReadService(
    db as unknown as PrismaService,
    {} as CollectionCanonicalRepository,
  );

/**
 * GR-13 회귀 테스트 전용 fixture. `source: 'ORG_PROVISIONED'` 저장소 하나와
 * `source: 'EXTERNAL_PUBLIC'` 저장소 하나를 같은 `repositoryIds` 배치에 넣고, mock
 * `findMany`가 실제 Prisma의 `where.source` 필터처럼 걸러내도록 구현한다 — 서비스 코드가
 * `source: 'ORG_PROVISIONED'`를 where에서 빼면 external 저장소 행도 그대로 새어 나와
 * 아래 각 GR-13 테스트가 실패한다.
 */
const ORG_REPOSITORY_ID = 101n;
const EXTERNAL_REPOSITORY_ID = 202n;
const REPOSITORY_SOURCE_BY_ID = new Map<bigint, string>([
  [ORG_REPOSITORY_ID, 'ORG_PROVISIONED'],
  [EXTERNAL_REPOSITORY_ID, 'EXTERNAL_PUBLIC'],
]);

/** `githubRepository.findMany` 호출을 `where.githubRepositoryId.in`/`where.source`로 필터링한다. */
function findManyGithubRepository<Row extends { githubRepositoryId: bigint }>(
  rows: readonly Row[],
): jest.Mock {
  return jest.fn(
    (args: {
      where: { githubRepositoryId: { in: readonly bigint[] }; source?: string };
    }) => {
      const { in: ids } = args.where.githubRepositoryId;
      const { source } = args.where;
      return Promise.resolve(
        rows.filter(
          (row) =>
            ids.includes(row.githubRepositoryId) &&
            (source === undefined ||
              REPOSITORY_SOURCE_BY_ID.get(row.githubRepositoryId) === source),
        ),
      );
    },
  );
}

/**
 * `collectionContributorYearAggregate.findMany` 호출을
 * `where.repository.githubRepositoryId.in`/`where.repository.source`로 필터링한다.
 */
function findManyContributorYearAggregate<
  Row extends { repository: { githubRepositoryId: bigint } },
>(rows: readonly Row[]): jest.Mock {
  return jest.fn(
    (args: {
      where: {
        repository: {
          githubRepositoryId: { in: readonly bigint[] };
          source?: string;
        };
      };
    }) => {
      const { in: ids } = args.where.repository.githubRepositoryId;
      const { source } = args.where.repository;
      return Promise.resolve(
        rows.filter(
          (row) =>
            ids.includes(row.repository.githubRepositoryId) &&
            (source === undefined ||
              REPOSITORY_SOURCE_BY_ID.get(row.repository.githubRepositoryId) ===
                source),
        ),
      );
    },
  );
}

/**
 * GR-13 — `findRepositoryActivity`는 이전까지 별도 spec 커버리지가 없었다(todo 14 전환
 * 시점에는 실제 운영 호출자가 `program-activity.service.ts` 하나뿐이라 위험이 없었기
 * 때문). `Repository`→`GithubRepository` 통합 이후 `repositoryIds`에 `EXTERNAL_PUBLIC`
 * 행 id가 섞여 들어올 수 있게 되면서 `source: 'ORG_PROVISIONED'` 가드가 필요해졌다 —
 * 그 가드 자체와 기존 동작(빈 배열 단락, author 필터, dataAsOf fallback)을 함께 고정한다.
 */
describe('CollectionReadService — findRepositoryActivity', () => {
  it('returns an empty array without querying when repositoryIds is empty', async () => {
    const db = createDb();

    const result = await serviceFor(db).findRepositoryActivity({
      repositoryIds: [],
    });

    expect(result).toEqual([]);
    expect(db.githubRepository.findMany).not.toHaveBeenCalled();
  });

  it('maps commit/PR/release dates and falls back to updatedAt for dataAsOf when there is no complete inventory observation', async () => {
    const db = createDb();
    const updatedAt = new Date('2026-07-31T00:00:00.000Z');
    const committedAt = new Date('2026-07-30T00:00:00.000Z');
    db.githubRepository.findMany.mockResolvedValue([
      {
        githubRepositoryId: 101n,
        updatedAt,
        lastCompleteInventoryObservedAt: null,
        commits: [{ committedAt }],
        pullRequests: [],
        releases: [],
      },
    ]);

    const result = await serviceFor(db).findRepositoryActivity({
      repositoryIds: [101n],
    });

    expect(result).toEqual([
      {
        repositoryId: 101n,
        dataAsOf: updatedAt,
        commitDates: [committedAt],
        pullRequestDates: [],
        releaseDates: [],
      },
    ]);
    expect(db.githubRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          githubRepositoryId: { in: [101n] },
          source: 'ORG_PROVISIONED',
        },
      }),
    );
  });

  it('GR-13: excludes an EXTERNAL_PUBLIC repository even when its id is explicitly requested alongside an ORG_PROVISIONED one', async () => {
    const db = createDb();
    const asOf = new Date('2026-07-31T00:00:00.000Z');
    db.githubRepository.findMany = findManyGithubRepository([
      {
        githubRepositoryId: ORG_REPOSITORY_ID,
        updatedAt: asOf,
        lastCompleteInventoryObservedAt: asOf,
        commits: [{ committedAt: asOf }],
        pullRequests: [],
        releases: [],
      },
      {
        githubRepositoryId: EXTERNAL_REPOSITORY_ID,
        updatedAt: asOf,
        lastCompleteInventoryObservedAt: asOf,
        commits: [{ committedAt: asOf }, { committedAt: asOf }],
        pullRequests: [],
        releases: [],
      },
    ]);

    const result = await serviceFor(db).findRepositoryActivity({
      repositoryIds: [ORG_REPOSITORY_ID, EXTERNAL_REPOSITORY_ID],
    });

    expect(result.map((row) => row.repositoryId)).toEqual([ORG_REPOSITORY_ID]);
  });
});

describe('CollectionReadService — getRepositoryMetrics', () => {
  it('returns an empty array without querying when repositoryIds is empty', async () => {
    const db = createDb();

    const result = await serviceFor(db).getRepositoryMetrics({
      repositoryIds: [],
    });

    expect(result).toEqual([]);
    expect(db.githubRepository.findMany).not.toHaveBeenCalled();
  });

  it('defaults to the current Asia/Seoul year and returns the eligibility-safe visibility DTO', async () => {
    const db = createDb();
    const observedAt = new Date('2026-07-30T00:00:00.000Z');
    db.githubRepository.findMany.mockResolvedValue([
      {
        githubRepositoryId: 101n,
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        lastCompleteInventoryObservedAt: observedAt,
        yearAggregates: [
          {
            commitCount: 3,
            pullRequestCount: 2,
            releaseCount: 1,
            updatedAt: new Date('2026-07-31T00:00:00.000Z'),
          },
        ],
      },
    ]);

    const result = await serviceFor(db).getRepositoryMetrics({
      repositoryIds: [101n],
    });

    expect(result).toEqual([
      {
        repositoryId: 101n,
        year: 2026,
        dataAsOf: new Date('2026-07-31T00:00:00.000Z'),
        commitCount: 3,
        pullRequestCount: 2,
        releaseCount: 1,
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        visibilityObservedAt: observedAt,
      },
    ]);
    expect(db.githubRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          githubRepositoryId: { in: [101n] },
          source: 'ORG_PROVISIONED',
        },
      }),
    );
  });

  it('returns a zero-value row and falls back to the last inventory observation for dataAsOf when the year has no aggregate yet (Jan 1 rollover)', async () => {
    const db = createDb();
    const observedAt = new Date('2025-12-15T00:00:00.000Z');
    db.githubRepository.findMany.mockResolvedValue([
      {
        githubRepositoryId: 202n,
        visibility: 'PRIVATE',
        presence: 'PRESENT',
        lastCompleteInventoryObservedAt: observedAt,
        yearAggregates: [],
      },
    ]);

    const result = await serviceFor(db).getRepositoryMetrics({
      repositoryIds: [202n],
      year: 2026,
    });

    expect(result).toEqual([
      {
        repositoryId: 202n,
        year: 2026,
        dataAsOf: observedAt,
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
        visibility: 'PRIVATE',
        presence: 'PRESENT',
        visibilityObservedAt: observedAt,
      },
    ]);
  });

  it('GR-13: excludes an EXTERNAL_PUBLIC repository even when its id is explicitly requested alongside an ORG_PROVISIONED one', async () => {
    const db = createDb();
    const asOf = new Date('2026-07-31T00:00:00.000Z');
    db.githubRepository.findMany = findManyGithubRepository([
      {
        githubRepositoryId: ORG_REPOSITORY_ID,
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        lastCompleteInventoryObservedAt: asOf,
        yearAggregates: [],
      },
      {
        githubRepositoryId: EXTERNAL_REPOSITORY_ID,
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        lastCompleteInventoryObservedAt: asOf,
        yearAggregates: [],
      },
    ]);

    const result = await serviceFor(db).getRepositoryMetrics({
      repositoryIds: [ORG_REPOSITORY_ID, EXTERNAL_REPOSITORY_ID],
      year: 2026,
    });

    expect(result.map((row) => row.repositoryId)).toEqual([ORG_REPOSITORY_ID]);
  });
});

describe('CollectionReadService — getContributorMetrics', () => {
  it('returns an empty array without querying when repositoryIds is empty', async () => {
    const db = createDb();

    const result = await serviceFor(db).getContributorMetrics({
      repositoryIds: [],
    });

    expect(result).toEqual([]);
    expect(
      db.collectionContributorYearAggregate.findMany,
    ).not.toHaveBeenCalled();
  });

  it('maps two distinct contributors of the same repository/year to separate rows', async () => {
    const db = createDb();
    db.collectionContributorYearAggregate.findMany.mockResolvedValue([
      {
        githubUserId: 1n,
        githubLogin: 'alice',
        commitCount: 4,
        pullRequestCount: 1,
        releaseCount: 0,
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
        repository: { githubRepositoryId: 101n },
      },
      {
        githubUserId: 2n,
        githubLogin: 'bob',
        commitCount: 1,
        pullRequestCount: 0,
        releaseCount: 1,
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
        repository: { githubRepositoryId: 101n },
      },
    ]);

    const result = await serviceFor(db).getContributorMetrics({
      repositoryIds: [101n],
      year: 2026,
    });

    expect(result).toEqual([
      {
        repositoryId: 101n,
        githubUserId: 1n,
        githubLogin: 'alice',
        year: 2026,
        dataAsOf: new Date('2026-07-31T00:00:00.000Z'),
        commitCount: 4,
        pullRequestCount: 1,
        releaseCount: 0,
      },
      {
        repositoryId: 101n,
        githubUserId: 2n,
        githubLogin: 'bob',
        year: 2026,
        dataAsOf: new Date('2026-07-31T00:00:00.000Z'),
        commitCount: 1,
        pullRequestCount: 0,
        releaseCount: 1,
      },
    ]);
    expect(db.collectionContributorYearAggregate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          year: 2026,
          repository: {
            githubRepositoryId: { in: [101n] },
            source: 'ORG_PROVISIONED',
          },
        },
      }),
    );
  });

  it('omits contributors with no fact in the requested year rather than defaulting to zero', async () => {
    const db = createDb();
    db.collectionContributorYearAggregate.findMany.mockResolvedValue([]);

    const result = await serviceFor(db).getContributorMetrics({
      repositoryIds: [101n],
      year: 2026,
    });

    expect(result).toEqual([]);
  });

  it('GR-13: excludes a contributor row belonging to an EXTERNAL_PUBLIC repository even when its id is explicitly requested alongside an ORG_PROVISIONED one', async () => {
    const db = createDb();
    const asOf = new Date('2026-07-31T00:00:00.000Z');
    db.collectionContributorYearAggregate.findMany =
      findManyContributorYearAggregate([
        {
          githubUserId: 1n,
          githubLogin: 'alice',
          commitCount: 4,
          pullRequestCount: 1,
          releaseCount: 0,
          updatedAt: asOf,
          repository: { githubRepositoryId: ORG_REPOSITORY_ID },
        },
        {
          githubUserId: 2n,
          githubLogin: 'bob',
          commitCount: 9,
          pullRequestCount: 9,
          releaseCount: 9,
          updatedAt: asOf,
          repository: { githubRepositoryId: EXTERNAL_REPOSITORY_ID },
        },
      ]);

    const result = await serviceFor(db).getContributorMetrics({
      repositoryIds: [ORG_REPOSITORY_ID, EXTERNAL_REPOSITORY_ID],
      year: 2026,
    });

    expect(result.map((row) => row.githubLogin)).toEqual(['alice']);
  });
});

describe('CollectionReadService — getPublicRankingMetrics', () => {
  it('filters to PUBLIC + PRESENT repositories at the query boundary', async () => {
    const db = createDb();
    db.collectionContributorYearAggregate.findMany.mockResolvedValue([]);

    await serviceFor(db).getPublicRankingMetrics({});

    expect(db.collectionContributorYearAggregate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repository: { visibility: 'PUBLIC', presence: 'PRESENT' } },
      }),
    );
  });

  it('adds a year filter only when currentYear is provided (THIS_YEAR vs ALL)', async () => {
    const db = createDb();
    db.collectionContributorYearAggregate.findMany.mockResolvedValue([]);

    await serviceFor(db).getPublicRankingMetrics({ currentYear: 2026 });

    expect(db.collectionContributorYearAggregate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repository: { visibility: 'PUBLIC', presence: 'PRESENT' },
          year: 2026,
        },
      }),
    );
  });

  it('merges repository/year rows into one entry per githubUserId', async () => {
    const db = createDb();
    db.collectionContributorYearAggregate.findMany.mockResolvedValue([
      {
        githubUserId: 1n,
        githubLogin: 'alice',
        commitCount: 2,
        pullRequestCount: 1,
        releaseCount: 0,
      },
      {
        githubUserId: 1n,
        githubLogin: 'alice',
        commitCount: 3,
        pullRequestCount: 0,
        releaseCount: 1,
      },
    ]);

    const result = await serviceFor(db).getPublicRankingMetrics({});

    expect(result).toEqual([
      {
        githubId: 1n,
        githubLogin: 'alice',
        commitCount: 5,
        prCount: 1,
        releaseCount: 1,
      },
    ]);
  });

  it('picks the lexicographically smallest normalized login as canonical when a login diverges across rows', async () => {
    const db = createDb();
    db.collectionContributorYearAggregate.findMany.mockResolvedValue([
      {
        githubUserId: 1n,
        githubLogin: 'Zed',
        commitCount: 1,
        pullRequestCount: 0,
        releaseCount: 0,
      },
      {
        githubUserId: 1n,
        githubLogin: 'alice',
        commitCount: 1,
        pullRequestCount: 0,
        releaseCount: 0,
      },
    ]);

    const result = await serviceFor(db).getPublicRankingMetrics({});

    expect(result).toEqual([
      {
        githubId: 1n,
        githubLogin: 'alice',
        commitCount: 2,
        prCount: 0,
        releaseCount: 0,
      },
    ]);
  });

  it('does not select repositoryId, year, dataAsOf, or any private/platform field', async () => {
    const db = createDb();
    db.collectionContributorYearAggregate.findMany.mockResolvedValue([]);

    await serviceFor(db).getPublicRankingMetrics({});

    expect(db.collectionContributorYearAggregate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          githubUserId: true,
          githubLogin: true,
          commitCount: true,
          pullRequestCount: true,
          releaseCount: true,
        },
      }),
    );
  });
});

describe('CollectionReadService — listPublicRankingYears', () => {
  it('lists distinct years with public non-zero activity newest first', async () => {
    const db = createDb();
    db.collectionContributorYearAggregate.findMany.mockResolvedValue([
      { year: 2026 },
      { year: 2025 },
    ]);

    await expect(serviceFor(db).listPublicRankingYears()).resolves.toEqual([
      2026, 2025,
    ]);

    expect(db.collectionContributorYearAggregate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repository: { visibility: 'PUBLIC', presence: 'PRESENT' },
          OR: [
            { commitCount: { gt: 0 } },
            { pullRequestCount: { gt: 0 } },
            { releaseCount: { gt: 0 } },
          ],
        },
        select: { year: true },
        distinct: ['year'],
        orderBy: { year: 'desc' },
      }),
    );
  });
});

/**
 * todo 16 — `getRepositoryCumulativeMetrics`/`getContributorCumulativeMetrics`만 다룬다.
 * `year` 필터 없이 전체 연도를 합산하는 lifetime 누적 계약을 검증한다.
 */
describe('CollectionReadService — getRepositoryCumulativeMetrics', () => {
  it('returns an empty array without querying when repositoryIds is empty', async () => {
    const db = createDb();

    const result = await serviceFor(db).getRepositoryCumulativeMetrics({
      repositoryIds: [],
    });

    expect(result).toEqual([]);
    expect(db.githubRepository.findMany).not.toHaveBeenCalled();
  });

  it('sums every year aggregate for a repository into one lifetime row without a year filter', async () => {
    const db = createDb();
    db.githubRepository.findMany.mockResolvedValue([
      {
        githubRepositoryId: 101n,
        lastCompleteInventoryObservedAt: new Date('2025-01-01T00:00:00.000Z'),
        yearAggregates: [
          {
            commitCount: 3,
            pullRequestCount: 2,
            releaseCount: 1,
            updatedAt: new Date('2025-12-31T00:00:00.000Z'),
          },
          {
            commitCount: 5,
            pullRequestCount: 1,
            releaseCount: 0,
            updatedAt: new Date('2026-07-31T00:00:00.000Z'),
          },
        ],
      },
    ]);

    const result = await serviceFor(db).getRepositoryCumulativeMetrics({
      repositoryIds: [101n],
    });

    expect(result).toEqual([
      {
        repositoryId: 101n,
        dataAsOf: new Date('2026-07-31T00:00:00.000Z'),
        commitCount: 8,
        pullRequestCount: 3,
        releaseCount: 1,
      },
    ]);
    expect(db.githubRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          githubRepositoryId: { in: [101n] },
          source: 'ORG_PROVISIONED',
        },
      }),
    );
    const calls = db.githubRepository.findMany.mock.calls as unknown[][];
    const call = calls[0]?.[0] as {
      select: { yearAggregates: { where?: unknown } };
    };
    expect(call.select.yearAggregates.where).toBeUndefined();
  });

  it('returns a zero-value row and falls back to the last inventory observation for dataAsOf when there is no aggregate yet', async () => {
    const db = createDb();
    const observedAt = new Date('2025-12-15T00:00:00.000Z');
    db.githubRepository.findMany.mockResolvedValue([
      {
        githubRepositoryId: 202n,
        lastCompleteInventoryObservedAt: observedAt,
        yearAggregates: [],
      },
    ]);

    const result = await serviceFor(db).getRepositoryCumulativeMetrics({
      repositoryIds: [202n],
    });

    expect(result).toEqual([
      {
        repositoryId: 202n,
        dataAsOf: observedAt,
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      },
    ]);
  });

  it('GR-13: excludes an EXTERNAL_PUBLIC repository even when its id is explicitly requested alongside an ORG_PROVISIONED one', async () => {
    const db = createDb();
    const asOf = new Date('2026-07-31T00:00:00.000Z');
    db.githubRepository.findMany = findManyGithubRepository([
      {
        githubRepositoryId: ORG_REPOSITORY_ID,
        lastCompleteInventoryObservedAt: asOf,
        yearAggregates: [],
      },
      {
        githubRepositoryId: EXTERNAL_REPOSITORY_ID,
        lastCompleteInventoryObservedAt: asOf,
        yearAggregates: [],
      },
    ]);

    const result = await serviceFor(db).getRepositoryCumulativeMetrics({
      repositoryIds: [ORG_REPOSITORY_ID, EXTERNAL_REPOSITORY_ID],
    });

    expect(result.map((row) => row.repositoryId)).toEqual([ORG_REPOSITORY_ID]);
  });
});

describe('CollectionReadService — getContributorCumulativeMetrics', () => {
  it('returns an empty array without querying when repositoryIds is empty', async () => {
    const db = createDb();

    const result = await serviceFor(db).getContributorCumulativeMetrics({
      repositoryIds: [],
    });

    expect(result).toEqual([]);
    expect(
      db.collectionContributorYearAggregate.findMany,
    ).not.toHaveBeenCalled();
  });

  it('sums a contributor across years without a year filter and keeps distinct contributors separate', async () => {
    const db = createDb();
    db.collectionContributorYearAggregate.findMany.mockResolvedValue([
      {
        githubUserId: 1n,
        githubLogin: 'alice',
        commitCount: 4,
        pullRequestCount: 1,
        releaseCount: 0,
        updatedAt: new Date('2025-12-31T00:00:00.000Z'),
        repository: { githubRepositoryId: 101n },
      },
      {
        githubUserId: 1n,
        githubLogin: 'alice',
        commitCount: 2,
        pullRequestCount: 0,
        releaseCount: 1,
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
        repository: { githubRepositoryId: 101n },
      },
      {
        githubUserId: 2n,
        githubLogin: 'bob',
        commitCount: 1,
        pullRequestCount: 0,
        releaseCount: 0,
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
        repository: { githubRepositoryId: 101n },
      },
    ]);

    const result = await serviceFor(db).getContributorCumulativeMetrics({
      repositoryIds: [101n],
    });

    expect(result).toEqual([
      {
        repositoryId: 101n,
        githubUserId: 1n,
        githubLogin: 'alice',
        dataAsOf: new Date('2026-07-31T00:00:00.000Z'),
        commitCount: 6,
        pullRequestCount: 1,
        releaseCount: 1,
      },
      {
        repositoryId: 101n,
        githubUserId: 2n,
        githubLogin: 'bob',
        dataAsOf: new Date('2026-07-31T00:00:00.000Z'),
        commitCount: 1,
        pullRequestCount: 0,
        releaseCount: 0,
      },
    ]);
    expect(db.collectionContributorYearAggregate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repository: {
            githubRepositoryId: { in: [101n] },
            source: 'ORG_PROVISIONED',
          },
        },
      }),
    );
  });

  it('returns an empty array when no contributor fact exists for the repositories', async () => {
    const db = createDb();
    db.collectionContributorYearAggregate.findMany.mockResolvedValue([]);

    const result = await serviceFor(db).getContributorCumulativeMetrics({
      repositoryIds: [101n],
    });

    expect(result).toEqual([]);
  });

  it('GR-13: excludes a contributor row belonging to an EXTERNAL_PUBLIC repository even when its id is explicitly requested alongside an ORG_PROVISIONED one', async () => {
    const db = createDb();
    const asOf = new Date('2026-07-31T00:00:00.000Z');
    db.collectionContributorYearAggregate.findMany =
      findManyContributorYearAggregate([
        {
          githubUserId: 1n,
          githubLogin: 'alice',
          commitCount: 4,
          pullRequestCount: 1,
          releaseCount: 0,
          updatedAt: asOf,
          repository: { githubRepositoryId: ORG_REPOSITORY_ID },
        },
        {
          githubUserId: 2n,
          githubLogin: 'bob',
          commitCount: 9,
          pullRequestCount: 9,
          releaseCount: 9,
          updatedAt: asOf,
          repository: { githubRepositoryId: EXTERNAL_REPOSITORY_ID },
        },
      ]);

    const result = await serviceFor(db).getContributorCumulativeMetrics({
      repositoryIds: [ORG_REPOSITORY_ID, EXTERNAL_REPOSITORY_ID],
    });

    expect(result.map((row) => row.githubLogin)).toEqual(['alice']);
  });
});

/**
 * todo 12 — `getIncrementalStatusSnapshot`. repository 이름/visibility는 절대 select하지
 * 않고 count/checkpoint 시각만 집계한다는 계약을 검증한다. health(empty/normal/delayed/
 * partial/failed) 해석은 system-status 쪽 책임이라 여기서는 다루지 않는다.
 */
describe('CollectionReadService — getIncrementalStatusSnapshot', () => {
  it('returns an all-zero/null snapshot when no repository is tracked (EMPTY source state)', async () => {
    const db = createDb();

    const result = await serviceFor(db).getIncrementalStatusSnapshot();

    expect(result).toEqual({
      trackedRepositoryCount: 0,
      readyStreamCount: 0,
      backfillingStreamCount: 0,
      partialStreamCount: 0,
      retryPendingStreamCount: 0,
      oldestReadyCheckpointAt: null,
      latestCheckpointAt: null,
      oldestRetryPendingAt: null,
      lastCycleStartedAt: null,
      lastCycleCompletedAt: null,
    });
    expect(db.githubRepository.count).toHaveBeenCalledWith({
      where: { presence: 'PRESENT', source: 'ORG_PROVISIONED' },
    });
  });

  it('reports every stream as READY with no partial/retry remainder (NORMAL source state)', async () => {
    const db = createDb();
    db.githubRepository.count.mockResolvedValue(2);
    db.collectionRepositoryStream.groupBy.mockResolvedValue([
      { status: 'READY', _count: { _all: 6 } },
    ]);
    const oldestReady = new Date('2026-07-30T00:00:00.000Z');
    const latest = new Date('2026-07-31T00:00:00.000Z');
    db.collectionRepositoryStream.aggregate.mockImplementation(
      ({ where }: { where: { status?: string; lastErrorCode?: unknown } }) => {
        if (where.lastErrorCode) {
          return Promise.resolve({ _min: { lastErrorAt: null } });
        }
        if (where.status === 'READY') {
          return Promise.resolve({ _min: { lastRunAt: oldestReady } });
        }
        return Promise.resolve({ _max: { lastRunAt: latest } });
      },
    );
    const cycleStartedAt = new Date('2026-07-31T00:00:00.000Z');
    const cycleCompletedAt = new Date('2026-07-31T00:05:00.000Z');
    db.collectionSyncCursor.findFirst.mockResolvedValue({
      cycleStartedAt,
      cycleCompletedAt,
    });

    const result = await serviceFor(db).getIncrementalStatusSnapshot();

    expect(result).toEqual({
      trackedRepositoryCount: 2,
      readyStreamCount: 6,
      backfillingStreamCount: 0,
      partialStreamCount: 0,
      retryPendingStreamCount: 0,
      oldestReadyCheckpointAt: oldestReady,
      latestCheckpointAt: latest,
      oldestRetryPendingAt: null,
      lastCycleStartedAt: cycleStartedAt,
      lastCycleCompletedAt: cycleCompletedAt,
    });
  });

  it('folds not-yet-created stream rows into partialStreamCount (PARTIAL source state)', async () => {
    const db = createDb();
    // 3 tracked repositories => 9 expected streams, but only 4 rows exist so far
    // (a repository just registered by inventory has no stream rows yet).
    db.githubRepository.count.mockResolvedValue(3);
    db.collectionRepositoryStream.groupBy.mockResolvedValue([
      { status: 'READY', _count: { _all: 2 } },
      { status: 'BACKFILLING', _count: { _all: 1 } },
      { status: 'PENDING', _count: { _all: 1 } },
    ]);

    const result = await serviceFor(db).getIncrementalStatusSnapshot();

    expect(result.readyStreamCount).toBe(2);
    expect(result.backfillingStreamCount).toBe(1);
    // 1 known PENDING + 5 not-yet-created (9 expected - 4 observed) = 6
    expect(result.partialStreamCount).toBe(6);
  });

  it('counts VERIFYING streams as partial and surfaces retry-pending state (FAILED/DELAYED source signal)', async () => {
    const db = createDb();
    db.githubRepository.count.mockResolvedValue(1);
    db.collectionRepositoryStream.groupBy.mockResolvedValue([
      { status: 'READY', _count: { _all: 2 } },
      { status: 'VERIFYING', _count: { _all: 1 } },
    ]);
    db.collectionRepositoryStream.count.mockResolvedValue(1);
    const oldestRetryPendingAt = new Date('2026-07-29T00:00:00.000Z');
    db.collectionRepositoryStream.aggregate.mockImplementation(
      ({ where }: { where: { status?: string; lastErrorCode?: unknown } }) => {
        if (where.status === 'READY') {
          return Promise.resolve({ _min: { lastRunAt: null } });
        }
        if (where.lastErrorCode) {
          return Promise.resolve({
            _min: { lastErrorAt: oldestRetryPendingAt },
          });
        }
        return Promise.resolve({ _max: { lastRunAt: null } });
      },
    );

    const result = await serviceFor(db).getIncrementalStatusSnapshot();

    expect(result.partialStreamCount).toBe(1);
    expect(result.retryPendingStreamCount).toBe(1);
    expect(result.oldestRetryPendingAt).toEqual(oldestRetryPendingAt);
    expect(db.collectionRepositoryStream.count).toHaveBeenCalledWith({
      where: {
        lastErrorCode: { not: null },
        repository: { presence: 'PRESENT', source: 'ORG_PROVISIONED' },
      },
    });
  });
});
