import { CollectionReadService } from './collection-read.service';
import type { PrismaService } from '../../prisma/prisma.service';

interface MockPrisma {
  contribution: { findMany: jest.Mock };
  user: { findMany: jest.Mock };
}

const createDb = (): MockPrisma => ({
  contribution: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  user: {
    findMany: jest.fn().mockResolvedValue([]),
  },
});

const serviceFor = (db: MockPrisma): CollectionReadService =>
  new CollectionReadService(db as unknown as PrismaService);

const ORG_REPOSITORY_ID = 101n;
const EXTERNAL_REPOSITORY_ID = 202n;
const REPOSITORY_SOURCE_BY_ID = new Map<bigint, string>([
  [ORG_REPOSITORY_ID, 'ORG_PROVISIONED'],
  [EXTERNAL_REPOSITORY_ID, 'EXTERNAL_PUBLIC'],
]);
const CONNECTED_REPOSITORY_IDS = new Set<bigint>();
const PROGRAM_LINKED_REPOSITORY_IDS = new Set<bigint>([
  ORG_REPOSITORY_ID,
  EXTERNAL_REPOSITORY_ID,
]);

type RepositoryWhereClause = {
  source?: string;
  applicationId?: { not: null };
  programId?: { not: null };
  teamId?: { not: null };
  AND?: readonly RepositoryWhereClause[];
  OR?: readonly RepositoryWhereClause[];
};

function matchesRepositoryClause(
  id: bigint,
  clause: RepositoryWhereClause,
): boolean {
  if (
    clause.source !== undefined &&
    clause.source !== REPOSITORY_SOURCE_BY_ID.get(id)
  ) {
    return false;
  }
  if (clause.applicationId !== undefined && !CONNECTED_REPOSITORY_IDS.has(id)) {
    return false;
  }
  if (
    clause.programId !== undefined &&
    !PROGRAM_LINKED_REPOSITORY_IDS.has(id)
  ) {
    return false;
  }
  if (clause.teamId !== undefined && !PROGRAM_LINKED_REPOSITORY_IDS.has(id)) {
    return false;
  }
  if (
    clause.AND !== undefined &&
    !clause.AND.every((nested) => matchesRepositoryClause(id, nested))
  ) {
    return false;
  }
  if (
    clause.OR !== undefined &&
    !clause.OR.some((nested) => matchesRepositoryClause(id, nested))
  ) {
    return false;
  }
  return true;
}

function findManyContributorYearAggregate<
  Row extends { repository: { githubRepositoryId: bigint } },
>(rows: readonly Row[]): jest.Mock {
  return jest.fn(
    (args: {
      where: {
        repository: RepositoryWhereClause & {
          githubRepositoryId: { in: readonly bigint[] };
        };
      };
    }) => {
      const { in: ids } = args.where.repository.githubRepositoryId;
      return Promise.resolve(
        rows.filter(
          (row) =>
            ids.includes(row.repository.githubRepositoryId) &&
            matchesRepositoryClause(
              row.repository.githubRepositoryId,
              args.where.repository,
            ),
        ),
      );
    },
  );
}

describe('CollectionReadService — getContributorMetrics', () => {
  it('returns an empty array without querying when repositoryIds is empty', async () => {
    const db = createDb();

    const result = await serviceFor(db).getContributorMetrics({
      repositoryIds: [],
    });

    expect(result).toEqual([]);
    expect(db.contribution.findMany).not.toHaveBeenCalled();
  });

  it('maps two distinct contributors of the same repository/year to separate rows', async () => {
    const db = createDb();
    db.user.findMany.mockResolvedValue([
      { githubId: 1n, nickname: 'alice' },
      { githubId: 2n, nickname: 'bob' },
    ]);
    db.contribution.findMany.mockResolvedValue([
      {
        githubId: 1n,
        commitCount: 4,
        pullRequestCount: 1,
        releaseCount: 0,
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
        repository: { githubRepositoryId: 101n },
      },
      {
        githubId: 2n,
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
    expect(db.contribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          date: {
            gte: new Date(Date.UTC(2026, 0, 1) - 9 * 60 * 60 * 1000),
            lt: new Date(Date.UTC(2027, 0, 1) - 9 * 60 * 60 * 1000),
          },
          repository: {
            githubRepositoryId: { in: [101n] },
            AND: [
              {
                OR: [
                  { source: 'ORG_PROVISIONED' },
                  { source: 'EXTERNAL_PUBLIC', applicationId: { not: null } },
                ],
              },
              { OR: [{ programId: { not: null } }, { teamId: { not: null } }] },
            ],
          },
        },
      }),
    );
  });

  it('omits contributors with no fact in the requested year rather than defaulting to zero', async () => {
    const db = createDb();
    db.user.findMany.mockResolvedValue([
      { githubId: 1n, nickname: 'alice' },
      { githubId: 2n, nickname: 'bob' },
    ]);
    db.contribution.findMany.mockResolvedValue([]);

    const result = await serviceFor(db).getContributorMetrics({
      repositoryIds: [101n],
      year: 2026,
    });

    expect(result).toEqual([]);
  });

  it('GR-13: excludes a contributor row belonging to an EXTERNAL_PUBLIC repository even when its id is explicitly requested alongside an ORG_PROVISIONED one', async () => {
    const db = createDb();
    const asOf = new Date('2026-07-31T00:00:00.000Z');
    db.user.findMany.mockResolvedValue([
      { githubId: 1n, nickname: 'alice' },
      { githubId: 2n, nickname: 'bob' },
    ]);
    db.contribution.findMany = findManyContributorYearAggregate([
      {
        githubId: 1n,
        commitCount: 4,
        pullRequestCount: 1,
        releaseCount: 0,
        updatedAt: asOf,
        repository: { githubRepositoryId: ORG_REPOSITORY_ID },
      },
      {
        githubId: 2n,
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
