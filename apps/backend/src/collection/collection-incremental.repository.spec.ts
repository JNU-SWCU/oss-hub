import { Prisma } from '@prisma/client';
import {
  asiaSeoulYear,
  CollectionIncrementalRepository,
} from './collection-incremental.repository';
import type { PrismaService } from '../prisma/prisma.service';

const uniqueViolation = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });

interface MockDb {
  collectionRepository: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
  };
  collectionCommitFact: { create: jest.Mock };
  collectionPullRequestFact: { create: jest.Mock };
  collectionReleaseFact: { create: jest.Mock };
  collectionRepositoryYearAggregate: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
  };
  collectionContributorYearAggregate: { upsert: jest.Mock };
  collectionRepositoryStream: { upsert: jest.Mock; findUnique: jest.Mock };
  collectionSyncCursor: { upsert: jest.Mock };
  $transaction: jest.Mock;
}

const createDb = (): MockDb => {
  const db: MockDb = {
    collectionRepository: { upsert: jest.fn(), findUnique: jest.fn() },
    collectionCommitFact: { create: jest.fn() },
    collectionPullRequestFact: { create: jest.fn() },
    collectionReleaseFact: { create: jest.fn() },
    collectionRepositoryYearAggregate: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    collectionContributorYearAggregate: { upsert: jest.fn() },
    collectionRepositoryStream: { upsert: jest.fn(), findUnique: jest.fn() },
    collectionSyncCursor: { upsert: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: MockDb) => Promise<unknown>) =>
      fn(db),
    ),
  };
  return db;
};

const repositoryFor = (db: MockDb): CollectionIncrementalRepository =>
  new CollectionIncrementalRepository(db as unknown as PrismaService);

describe('asiaSeoulYear', () => {
  it('UTC 12/31 15:30(=KST 1/1 00:30)을 다음 해로 계산한다', () => {
    expect(asiaSeoulYear(new Date('2025-12-31T15:30:00.000Z'))).toBe(2026);
  });

  it('UTC 12/31 14:30(=KST 12/31 23:30)은 이전 해로 유지한다', () => {
    expect(asiaSeoulYear(new Date('2025-12-31T14:30:00.000Z'))).toBe(2025);
  });
});

describe('CollectionIncrementalRepository — repository identity', () => {
  it('App installation id 없이 (githubOrganizationId, githubRepositoryId)로만 upsert한다', async () => {
    const db = createDb();
    db.collectionRepository.upsert.mockResolvedValue({ id: 'repo-1' });

    await repositoryFor(db).recordRepositoryObservation({
      githubOrganizationId: 10n,
      githubRepositoryId: 20n,
      fullName: 'org/repo',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      observedAt: new Date('2026-07-31T00:00:00.000Z'),
    });

    expect(db.collectionRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          githubOrganizationId_githubRepositoryId: {
            githubOrganizationId: 10n,
            githubRepositoryId: 20n,
          },
        },
      }),
    );
    const calls = db.collectionRepository.upsert.mock
      .calls as unknown as ReadonlyArray<
      readonly [
        {
          readonly create: Record<string, unknown>;
          readonly update: Record<string, unknown>;
        },
      ]
    >;
    const call = calls[0]?.[0];
    expect(call?.create).not.toHaveProperty('appId');
    expect(call?.update).not.toHaveProperty('appId');
  });
});

describe('CollectionIncrementalRepository — commit facts', () => {
  it('신규 fact는 삽입하고 repository/contributor 연도 집계를 1씩 증가시킨다', async () => {
    const db = createDb();
    db.collectionCommitFact.create.mockResolvedValue({});
    db.collectionRepositoryYearAggregate.upsert.mockResolvedValue({});
    db.collectionContributorYearAggregate.upsert.mockResolvedValue({});

    const result = await repositoryFor(db).recordCommitFacts('repo-1', [
      {
        sha: 'abc',
        committedAt: new Date('2026-03-01T00:00:00.000Z'),
        authorGithubId: 99n,
        authorGithubLogin: 'octocat',
      },
    ]);

    expect(result.insertedCount).toBe(1);
    expect(db.collectionRepositoryYearAggregate.upsert).toHaveBeenCalledTimes(
      1,
    );
    expect(db.collectionContributorYearAggregate.upsert).toHaveBeenCalledTimes(
      1,
    );
  });

  it('중복 fact(unique 제약 위반)는 무시하고 집계를 증가시키지 않는다 — idempotent', async () => {
    const db = createDb();
    db.collectionCommitFact.create.mockRejectedValue(uniqueViolation());

    const result = await repositoryFor(db).recordCommitFacts('repo-1', [
      { sha: 'dup', committedAt: new Date('2026-03-01T00:00:00.000Z') },
    ]);

    expect(result.insertedCount).toBe(0);
    expect(db.collectionRepositoryYearAggregate.upsert).not.toHaveBeenCalled();
  });

  it('unique 제약 위반이 아닌 오류는 그대로 전파한다', async () => {
    const db = createDb();
    db.collectionCommitFact.create.mockRejectedValue(new Error('boom'));

    await expect(
      repositoryFor(db).recordCommitFacts('repo-1', [
        { sha: 'x', committedAt: new Date('2026-03-01T00:00:00.000Z') },
      ]),
    ).rejects.toThrow('boom');
  });
});

describe('CollectionIncrementalRepository — transactional scope (todo 8 import)', () => {
  it('runs the callback against a repository scoped to one Prisma transaction and returns its result', async () => {
    const db = createDb();
    db.collectionRepository.upsert.mockResolvedValue({ id: 'repo-1' });

    const result = await repositoryFor(db).runInTransaction(async (repo) => {
      const row = await repo.recordRepositoryObservation({
        githubOrganizationId: 10n,
        githubRepositoryId: 20n,
        fullName: 'org/repo',
        defaultBranch: 'main',
        archived: false,
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        observedAt: new Date('2026-07-31T00:00:00.000Z'),
      });
      return row.id;
    });

    expect(result).toBe('repo-1');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.collectionRepository.upsert).toHaveBeenCalledTimes(1);
  });

  it('propagates a mid-callback failure so the caller sees no partial success', async () => {
    const db = createDb();
    db.collectionRepository.upsert.mockRejectedValue(new Error('boom'));

    await expect(
      repositoryFor(db).runInTransaction(async (repo) => {
        await repo.recordRepositoryObservation({
          githubOrganizationId: 10n,
          githubRepositoryId: 20n,
          fullName: 'org/repo',
          defaultBranch: 'main',
          archived: false,
          visibility: 'PUBLIC',
          presence: 'PRESENT',
          observedAt: new Date('2026-07-31T00:00:00.000Z'),
        });
      }),
    ).rejects.toThrow('boom');
  });
});

describe('CollectionIncrementalRepository — Jan-1 empty current-year read', () => {
  it('해당 연도 집계 행이 없으면 0으로 채운 기본값을 반환한다', async () => {
    const db = createDb();
    db.collectionRepositoryYearAggregate.findUnique.mockResolvedValue(null);

    const result = await repositoryFor(db).getRepositoryYearAggregate(
      'repo-1',
      2027,
    );

    expect(result).toEqual({
      repositoryId: 'repo-1',
      year: 2027,
      commitCount: 0,
      pullRequestCount: 0,
      releaseCount: 0,
    });
  });
});
