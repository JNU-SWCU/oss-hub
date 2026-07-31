import {
  asiaSeoulYear,
  CollectionIncrementalRepository,
} from './collection-incremental.repository';
import type { PrismaService } from '../prisma/prisma.service';

interface MockDb {
  collectionRepository: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    findMany: jest.Mock;
  };
  collectionCommitFact: {
    createMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
  };
  collectionPullRequestFact: {
    createMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
  };
  collectionReleaseFact: {
    createMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
  };
  collectionRepositoryYearAggregate: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
  };
  collectionContributorYearAggregate: { upsert: jest.Mock };
  collectionRepositoryStream: { upsert: jest.Mock; findUnique: jest.Mock };
  collectionSyncCursor: { upsert: jest.Mock; findUnique: jest.Mock };
  $transaction: jest.Mock;
  $queryRawUnsafe: jest.Mock;
  $executeRawUnsafe: jest.Mock;
}

/** 기본값은 "빈 DB"(COUNT 0, 최신 fact 없음) — 각 테스트가 필요한 만큼만 override한다. */
const createDb = (): MockDb => {
  const db: MockDb = {
    collectionRepository: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    collectionCommitFact: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    collectionPullRequestFact: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    collectionReleaseFact: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    collectionRepositoryYearAggregate: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
    },
    collectionContributorYearAggregate: {
      upsert: jest.fn().mockResolvedValue({}),
    },
    collectionRepositoryStream: { upsert: jest.fn(), findUnique: jest.fn() },
    collectionSyncCursor: { upsert: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: MockDb) => Promise<unknown>) =>
      fn(db),
    ),
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
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

describe('CollectionIncrementalRepository — commit facts (deterministic rebuild)', () => {
  it('createMany(skipDuplicates)로 삽입하고 실제 삽입 개수를 반환한다', async () => {
    const db = createDb();
    db.collectionCommitFact.createMany.mockResolvedValue({ count: 1 });

    const result = await repositoryFor(db).recordCommitFacts('repo-1', [
      {
        sha: 'abc',
        committedAt: new Date('2026-03-01T00:00:00.000Z'),
        authorGithubId: 99n,
        authorGithubLogin: 'octocat',
      },
    ]);

    expect(result.insertedCount).toBe(1);
    expect(db.collectionCommitFact.createMany).toHaveBeenCalledWith({
      data: [
        {
          repositoryId: 'repo-1',
          sha: 'abc',
          committedAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 99n,
          authorGithubLogin: 'octocat',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('빈 배열은 DB를 건드리지 않고 0을 반환한다', async () => {
    const db = createDb();

    const result = await repositoryFor(db).recordCommitFacts('repo-1', []);

    expect(result).toEqual({ insertedCount: 0 });
    expect(db.collectionCommitFact.createMany).not.toHaveBeenCalled();
  });

  it('rebuild는 createMany 삽입 개수가 아니라 facts 테이블 실제 COUNT로 집계를 덮어쓴다 — 중복 재시도에도 불변', async () => {
    const db = createDb();
    // 이번 배치는 신규 1건뿐이라고 보고하지만(재시도로 나머지는 이미 존재),
    // DB에는 이미 해당 연도에 총 5건이 쌓여 있다고 가정한다.
    db.collectionCommitFact.createMany.mockResolvedValue({ count: 1 });
    db.collectionCommitFact.count.mockResolvedValue(5);

    await repositoryFor(db).recordCommitFacts('repo-1', [
      { sha: 'retry', committedAt: new Date('2026-03-01T00:00:00.000Z') },
    ]);

    expect(db.collectionRepositoryYearAggregate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repositoryId_year: { repositoryId: 'repo-1', year: 2026 } },
        update: { commitCount: 5, pullRequestCount: 0, releaseCount: 0 },
      }),
    );
  });

  it('두 명의 기여자가 같은 배치에 섞여도 각자의 contributor 집계로 분리된다', async () => {
    const db = createDb();
    db.collectionCommitFact.createMany.mockResolvedValue({ count: 2 });
    db.collectionCommitFact.count.mockImplementation(
      ({ where }: { where: { authorGithubId?: bigint } }) => {
        if (where.authorGithubId === 1n) return Promise.resolve(1);
        if (where.authorGithubId === 2n) return Promise.resolve(1);
        return Promise.resolve(2);
      },
    );
    db.collectionCommitFact.findFirst.mockImplementation(
      ({ where }: { where: { authorGithubId?: bigint } }) =>
        Promise.resolve(
          where.authorGithubId === 1n
            ? { authorGithubLogin: 'alice', committedAt: new Date() }
            : { authorGithubLogin: 'bob', committedAt: new Date() },
        ),
    );

    await repositoryFor(db).recordCommitFacts('repo-1', [
      {
        sha: 'a',
        committedAt: new Date('2026-03-01T00:00:00.000Z'),
        authorGithubId: 1n,
        authorGithubLogin: 'alice',
      },
      {
        sha: 'b',
        committedAt: new Date('2026-03-02T00:00:00.000Z'),
        authorGithubId: 2n,
        authorGithubLogin: 'bob',
      },
    ]);

    expect(db.collectionContributorYearAggregate.upsert).toHaveBeenCalledTimes(
      2,
    );
    expect(db.collectionContributorYearAggregate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repositoryId_githubUserId_year: {
            repositoryId: 'repo-1',
            githubUserId: 1n,
            year: 2026,
          },
        },
      }),
    );
    expect(db.collectionContributorYearAggregate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repositoryId_githubUserId_year: {
            repositoryId: 'repo-1',
            githubUserId: 2n,
            year: 2026,
          },
        },
      }),
    );
  });

  it('author가 null인 fact는 repository 총계에는 포함되지만 contributor 집계는 만들지 않는다', async () => {
    const db = createDb();
    db.collectionCommitFact.createMany.mockResolvedValue({ count: 1 });
    db.collectionCommitFact.count.mockResolvedValue(1);

    await repositoryFor(db).recordCommitFacts('repo-1', [
      { sha: 'anon', committedAt: new Date('2026-03-01T00:00:00.000Z') },
    ]);

    expect(db.collectionRepositoryYearAggregate.upsert).toHaveBeenCalledTimes(
      1,
    );
    expect(db.collectionContributorYearAggregate.upsert).not.toHaveBeenCalled();
  });

  it('연도 경계를 넘나드는 배치는 두 연도 각각의 집계를 재계산한다(Asia/Seoul 기준)', async () => {
    const db = createDb();
    db.collectionCommitFact.createMany.mockResolvedValue({ count: 2 });

    await repositoryFor(db).recordCommitFacts('repo-1', [
      // KST 2025-12-31 23:30 -> 2025년
      { sha: 'y2025', committedAt: new Date('2025-12-31T14:30:00.000Z') },
      // KST 2026-01-01 00:30 -> 2026년
      { sha: 'y2026', committedAt: new Date('2025-12-31T15:30:00.000Z') },
    ]);

    expect(db.collectionRepositoryYearAggregate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repositoryId_year: { repositoryId: 'repo-1', year: 2025 } },
      }),
    );
    expect(db.collectionRepositoryYearAggregate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repositoryId_year: { repositoryId: 'repo-1', year: 2026 } },
      }),
    );
    expect(db.collectionRepositoryYearAggregate.upsert).toHaveBeenCalledTimes(
      2,
    );
  });
});

describe('CollectionIncrementalRepository — pull request facts (parity)', () => {
  it('createMany(skipDuplicates)로 삽입하고 rebuild로 집계를 덮어쓴다', async () => {
    const db = createDb();
    db.collectionPullRequestFact.createMany.mockResolvedValue({ count: 1 });
    db.collectionPullRequestFact.count.mockResolvedValue(3);

    const result = await repositoryFor(db).recordPullRequestFacts('repo-1', [
      {
        githubPullRequestId: 7n,
        state: 'MERGED',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        authorGithubId: 42n,
        authorGithubLogin: 'octocat',
      },
    ]);

    expect(result.insertedCount).toBe(1);
    expect(db.collectionPullRequestFact.createMany).toHaveBeenCalledWith({
      data: [
        {
          repositoryId: 'repo-1',
          githubPullRequestId: 7n,
          state: 'MERGED',
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          authorGithubId: 42n,
          authorGithubLogin: 'octocat',
        },
      ],
      skipDuplicates: true,
    });
    expect(db.collectionRepositoryYearAggregate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { commitCount: 0, pullRequestCount: 3, releaseCount: 0 },
      }),
    );
  });

  it('빈 배열은 DB를 건드리지 않는다', async () => {
    const db = createDb();

    const result = await repositoryFor(db).recordPullRequestFacts('repo-1', []);

    expect(result).toEqual({ insertedCount: 0 });
    expect(db.collectionPullRequestFact.createMany).not.toHaveBeenCalled();
  });
});

describe('CollectionIncrementalRepository — release facts (parity)', () => {
  it('createMany(skipDuplicates)로 삽입하고 rebuild로 집계를 덮어쓴다', async () => {
    const db = createDb();
    db.collectionReleaseFact.createMany.mockResolvedValue({ count: 1 });
    db.collectionReleaseFact.count.mockResolvedValue(2);

    const result = await repositoryFor(db).recordReleaseFacts('repo-1', [
      {
        githubReleaseId: 9n,
        publishedAt: new Date('2026-06-01T00:00:00.000Z'),
        authorGithubId: 42n,
        authorGithubLogin: 'octocat',
      },
    ]);

    expect(result.insertedCount).toBe(1);
    expect(db.collectionReleaseFact.createMany).toHaveBeenCalledWith({
      data: [
        {
          repositoryId: 'repo-1',
          githubReleaseId: 9n,
          publishedAt: new Date('2026-06-01T00:00:00.000Z'),
          authorGithubId: 42n,
          authorGithubLogin: 'octocat',
        },
      ],
      skipDuplicates: true,
    });
    expect(db.collectionRepositoryYearAggregate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { commitCount: 0, pullRequestCount: 0, releaseCount: 2 },
      }),
    );
  });

  it('빈 배열은 DB를 건드리지 않는다', async () => {
    const db = createDb();

    const result = await repositoryFor(db).recordReleaseFacts('repo-1', []);

    expect(result).toEqual({ insertedCount: 0 });
    expect(db.collectionReleaseFact.createMany).not.toHaveBeenCalled();
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

describe('CollectionIncrementalRepository — todo 10 sync cursor/inventory', () => {
  it('getSyncCursor은 (appId, organizationLogin) 복합키로 조회한다', async () => {
    const db = createDb();
    db.collectionSyncCursor.findUnique.mockResolvedValue({
      appId: 1n,
      organizationLogin: 'jnu-swcu',
      lastGithubRepositoryId: 5n,
      cycleStartedAt: null,
      cycleCompletedAt: null,
    });

    const result = await repositoryFor(db).getSyncCursor(1n, 'jnu-swcu');

    expect(db.collectionSyncCursor.findUnique).toHaveBeenCalledWith({
      where: {
        appId_organizationLogin: { appId: 1n, organizationLogin: 'jnu-swcu' },
      },
    });
    expect(result?.lastGithubRepositoryId).toBe(5n);
  });

  it('markAbsentRepositories는 이번 관찰에 없는 PRESENT 저장소만 ABSENT로 갱신한다', async () => {
    const db = createDb();
    db.collectionRepository.updateMany.mockResolvedValue({ count: 2 });

    const observedAt = new Date('2026-08-01T00:00:00.000Z');
    await repositoryFor(db).markAbsentRepositories(10n, [1n, 2n], observedAt);

    expect(db.collectionRepository.updateMany).toHaveBeenCalledWith({
      where: {
        githubOrganizationId: 10n,
        presence: 'PRESENT',
        githubRepositoryId: { notIn: [1n, 2n] },
      },
      data: { presence: 'ABSENT', lastCompleteInventoryObservedAt: observedAt },
    });
  });

  it('listPresentRepositories는 partial inventory 시 이어갈 PRESENT 저장소만 읽는다', async () => {
    const db = createDb();
    db.collectionRepository.findMany.mockResolvedValue([{ id: 'repo-1' }]);

    const result = await repositoryFor(db).listPresentRepositories(10n);

    expect(db.collectionRepository.findMany).toHaveBeenCalledWith({
      where: { githubOrganizationId: 10n, presence: 'PRESENT' },
    });
    expect(result).toEqual([{ id: 'repo-1' }]);
  });
});

describe('CollectionIncrementalRepository — todo 10 sync lease (epoch fencing)', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  const expiresAt = new Date('2026-08-01T00:10:00.000Z');

  it('acquireSyncLease는 만료된(또는 없는) lease만 훔치고, 살아있으면 null을 반환한다', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValue([
      {
        appId: 1n,
        organizationLogin: 'jnu-swcu',
        ownerId: 'owner-1',
        epoch: 1n,
        runId: 'run-1',
        expiresAt,
      },
    ]);

    const token = await repositoryFor(db).acquireSyncLease({
      appId: 1n,
      organizationLogin: 'jnu-swcu',
      ownerId: 'owner-1',
      runId: 'run-1',
      now,
      expiresAt,
    });

    expect(token?.runId).toBe('run-1');
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "CollectionSyncLease"'),
      1n,
      'jnu-swcu',
      'owner-1',
      expiresAt,
      'run-1',
      now,
    );
  });

  it('acquireSyncLease는 아무 행도 반환되지 않으면(살아있는 lease) null을 반환한다', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValue([]);

    const token = await repositoryFor(db).acquireSyncLease({
      appId: 1n,
      organizationLogin: 'jnu-swcu',
      ownerId: 'owner-1',
      runId: 'run-1',
      now,
      expiresAt,
    });

    expect(token).toBeNull();
  });

  it('heartbeatSyncLease는 정확히 1행 갱신되지 않으면(stale) 던진다', async () => {
    const db = createDb();
    db.$executeRawUnsafe.mockResolvedValue(0);

    await expect(
      repositoryFor(db).heartbeatSyncLease(
        {
          appId: 1n,
          organizationLogin: 'jnu-swcu',
          ownerId: 'owner-1',
          epoch: 1n,
          runId: 'run-1',
          expiresAt,
        },
        now,
        expiresAt,
      ),
    ).rejects.toThrow('Collection sync lease is stale');
  });

  it('heartbeatSyncLease는 1행 갱신되면 정상 반환한다', async () => {
    const db = createDb();
    db.$executeRawUnsafe.mockResolvedValue(1);

    await expect(
      repositoryFor(db).heartbeatSyncLease(
        {
          appId: 1n,
          organizationLogin: 'jnu-swcu',
          ownerId: 'owner-1',
          epoch: 1n,
          runId: 'run-1',
          expiresAt,
        },
        now,
        expiresAt,
      ),
    ).resolves.toBeUndefined();
  });

  it('releaseSyncLease는 best-effort로 조건에 맞는 lease만 만료시킨다', async () => {
    const db = createDb();
    db.$executeRawUnsafe.mockResolvedValue(1);

    await repositoryFor(db).releaseSyncLease(
      {
        appId: 1n,
        organizationLogin: 'jnu-swcu',
        ownerId: 'owner-1',
        epoch: 1n,
        runId: 'run-1',
        expiresAt,
      },
      now,
    );

    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "CollectionSyncLease"'),
      1n,
      'jnu-swcu',
      'owner-1',
      1n,
      'run-1',
      now,
    );
  });

  it('assertSyncLeaseValid는 소유권이 확인되지 않으면(stale) 던진다', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValue([]);

    await expect(
      repositoryFor(db).assertSyncLeaseValid(
        {
          appId: 1n,
          organizationLogin: 'jnu-swcu',
          ownerId: 'owner-1',
          epoch: 1n,
          runId: 'run-1',
          expiresAt,
        },
        now,
      ),
    ).rejects.toThrow('Collection sync lease is stale');
  });

  it('assertSyncLeaseValid는 소유권이 확인되면 정상 반환한다(FOR UPDATE로 행을 잠근다)', async () => {
    const db = createDb();
    db.$queryRawUnsafe.mockResolvedValue([{ owned: true }]);

    await expect(
      repositoryFor(db).assertSyncLeaseValid(
        {
          appId: 1n,
          organizationLogin: 'jnu-swcu',
          ownerId: 'owner-1',
          epoch: 1n,
          runId: 'run-1',
          expiresAt,
        },
        now,
      ),
    ).resolves.toBeUndefined();
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      1n,
      'jnu-swcu',
      'owner-1',
      1n,
      'run-1',
      now,
    );
  });
});
