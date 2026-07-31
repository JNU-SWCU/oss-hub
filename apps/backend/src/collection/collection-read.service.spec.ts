import { CollectionReadService } from './collection-read.service';
import type { CollectionCanonicalRepository } from './collection-canonical.repository';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * todo 11 — `getRepositoryMetrics`/`getContributorMetrics`만 다룬다. 기존 3개 메서드
 * (`findRepositoryActivity`/`findRankingActivity`/`getStatusSnapshot`)는 이 todo에서
 * 변경하지 않았고 별도 spec 커버리지도 요구하지 않는다.
 */
interface MockPrisma {
  collectionRepository: { findMany: jest.Mock };
  collectionContributorYearAggregate: { findMany: jest.Mock };
}

const createDb = (): MockPrisma => ({
  collectionRepository: { findMany: jest.fn().mockResolvedValue([]) },
  collectionContributorYearAggregate: {
    findMany: jest.fn().mockResolvedValue([]),
  },
});

const serviceFor = (db: MockPrisma): CollectionReadService =>
  new CollectionReadService(
    db as unknown as PrismaService,
    {} as CollectionCanonicalRepository,
  );

describe('CollectionReadService — getRepositoryMetrics', () => {
  it('returns an empty array without querying when repositoryIds is empty', async () => {
    const db = createDb();

    const result = await serviceFor(db).getRepositoryMetrics({
      repositoryIds: [],
    });

    expect(result).toEqual([]);
    expect(db.collectionRepository.findMany).not.toHaveBeenCalled();
  });

  it('defaults to the current Asia/Seoul year and returns the eligibility-safe visibility DTO', async () => {
    const db = createDb();
    const observedAt = new Date('2026-07-30T00:00:00.000Z');
    db.collectionRepository.findMany.mockResolvedValue([
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
    expect(db.collectionRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { githubRepositoryId: { in: [101n] } },
      }),
    );
  });

  it('returns a zero-value row and falls back to the last inventory observation for dataAsOf when the year has no aggregate yet (Jan 1 rollover)', async () => {
    const db = createDb();
    const observedAt = new Date('2025-12-15T00:00:00.000Z');
    db.collectionRepository.findMany.mockResolvedValue([
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
          repository: { githubRepositoryId: { in: [101n] } },
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
