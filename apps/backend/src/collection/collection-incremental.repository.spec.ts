import {
  asiaSeoulYear,
  CollectionIncrementalRepository,
} from './collection-incremental.repository';
import type { PrismaService } from '../prisma/prisma.service';

interface MockDb {
  githubRepository: {
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
  collectionRepositoryStream: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
    groupBy: jest.Mock;
    updateMany: jest.Mock;
  };
  collectionSyncCursor: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  collectionSyncLease: { findMany: jest.Mock };
  $transaction: jest.Mock;
  $queryRawUnsafe: jest.Mock;
  $executeRawUnsafe: jest.Mock;
}

/** 기본값은 "빈 DB"(COUNT 0, 최신 fact 없음) — 각 테스트가 필요한 만큼만 override한다. */
const createDb = (): MockDb => {
  const db: MockDb = {
    githubRepository: {
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
    collectionRepositoryStream: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    collectionSyncCursor: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    collectionSyncLease: { findMany: jest.fn().mockResolvedValue([]) },
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

/**
 * `where` 절을 얕은 동등 비교 + `{ notIn }` 연산자만 지원하는 최소 Prisma 흉내로
 * 매칭한다. GR-6 회귀 테스트가 "실제로 실패할 수 있는" 테스트가 되려면 mock이 호출
 * 인자를 그대로 기록하는 것으로는 부족하다 — production 코드가 `source` 필터를
 * where 절에서 빠뜨리면 이 fake가 그 실수를 그대로 반영해 external 행도 갱신/조회
 * 대상에 포함시켜야 테스트가 fail한다.
 */
interface FakeRepoRow {
  id: string;
  githubOrganizationId: bigint | null;
  githubRepositoryId: bigint;
  presence: 'PRESENT' | 'ABSENT';
  source: 'ORG_PROVISIONED' | 'EXTERNAL_PUBLIC';
}

function matchesWhere(
  row: FakeRepoRow,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = (row as unknown as Record<string, unknown>)[key];
    if (
      condition !== null &&
      typeof condition === 'object' &&
      'notIn' in (condition as Record<string, unknown>)
    ) {
      const notIn = (condition as { notIn: readonly unknown[] }).notIn;
      return !notIn.includes(value);
    }
    return value === condition;
  });
}

function createFakeGithubRepositoryStore(seed: readonly FakeRepoRow[]) {
  const rows = seed.map((row) => ({ ...row }));
  return {
    rows,
    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<FakeRepoRow>;
      }) => {
        let count = 0;
        for (const row of rows) {
          if (matchesWhere(row, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
    ),
    findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((row) => matchesWhere(row, where))),
    ),
  };
}

describe('asiaSeoulYear', () => {
  it('UTC 12/31 15:30(=KST 1/1 00:30)을 다음 해로 계산한다', () => {
    expect(asiaSeoulYear(new Date('2025-12-31T15:30:00.000Z'))).toBe(2026);
  });

  it('UTC 12/31 14:30(=KST 12/31 23:30)은 이전 해로 유지한다', () => {
    expect(asiaSeoulYear(new Date('2025-12-31T14:30:00.000Z'))).toBe(2025);
  });
});

describe('CollectionIncrementalRepository — repository identity', () => {
  it('githubRepositoryId 단일 unique key로 upsert한다(github repository id는 전역 유일)', async () => {
    const db = createDb();
    db.githubRepository.upsert.mockResolvedValue({ id: 'repo-1' });

    await repositoryFor(db).recordRepositoryObservation({
      githubOrganizationId: 10n,
      githubRepositoryId: 20n,
      nameWithOwner: 'org/repo',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      source: 'ORG_PROVISIONED',
      observedAt: new Date('2026-07-31T00:00:00.000Z'),
    });

    expect(db.githubRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { githubRepositoryId: 20n },
      }),
    );
    const calls = db.githubRepository.upsert.mock
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
    expect(call?.create).toMatchObject({ source: 'ORG_PROVISIONED' });
    expect(call?.update).toMatchObject({
      source: 'ORG_PROVISIONED',
      githubOrganizationId: 10n,
    });
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
    db.githubRepository.upsert.mockResolvedValue({ id: 'repo-1' });

    const result = await repositoryFor(db).runInTransaction(async (repo) => {
      const row = await repo.recordRepositoryObservation({
        githubOrganizationId: 10n,
        githubRepositoryId: 20n,
        nameWithOwner: 'org/repo',
        defaultBranch: 'main',
        archived: false,
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        source: 'ORG_PROVISIONED',
        observedAt: new Date('2026-07-31T00:00:00.000Z'),
      });
      return row.id;
    });

    expect(result).toBe('repo-1');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.githubRepository.upsert).toHaveBeenCalledTimes(1);
  });

  it('propagates a mid-callback failure so the caller sees no partial success', async () => {
    const db = createDb();
    db.githubRepository.upsert.mockRejectedValue(new Error('boom'));

    await expect(
      repositoryFor(db).runInTransaction(async (repo) => {
        await repo.recordRepositoryObservation({
          githubOrganizationId: 10n,
          githubRepositoryId: 20n,
          nameWithOwner: 'org/repo',
          defaultBranch: 'main',
          archived: false,
          visibility: 'PUBLIC',
          presence: 'PRESENT',
          source: 'ORG_PROVISIONED',
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
  it('getSyncCursor은 (appId, scope) 복합키로 조회한다', async () => {
    const db = createDb();
    db.collectionSyncCursor.findUnique.mockResolvedValue({
      appId: 1n,
      scope: 'org:jnu-swcu',
      lastGithubRepositoryId: 5n,
      cycleStartedAt: null,
      cycleCompletedAt: null,
    });

    const result = await repositoryFor(db).getSyncCursor(1n, 'org:jnu-swcu');

    expect(db.collectionSyncCursor.findUnique).toHaveBeenCalledWith({
      where: {
        appId_scope: { appId: 1n, scope: 'org:jnu-swcu' },
      },
    });
    expect(result?.lastGithubRepositoryId).toBe(5n);
  });

  it('markAbsentRepositories는 이번 관찰에 없는 PRESENT 저장소만 ABSENT로 갱신한다', async () => {
    const db = createDb();
    db.githubRepository.updateMany.mockResolvedValue({ count: 2 });

    const observedAt = new Date('2026-08-01T00:00:00.000Z');
    await repositoryFor(db).markAbsentRepositories(10n, [1n, 2n], observedAt);

    expect(db.githubRepository.updateMany).toHaveBeenCalledWith({
      where: {
        githubOrganizationId: 10n,
        source: 'ORG_PROVISIONED',
        presence: 'PRESENT',
        githubRepositoryId: { notIn: [1n, 2n] },
      },
      data: { presence: 'ABSENT', lastCompleteInventoryObservedAt: observedAt },
    });
  });

  it('listPresentRepositories는 partial inventory 시 이어갈 PRESENT 저장소만 읽는다', async () => {
    const db = createDb();
    db.githubRepository.findMany.mockResolvedValue([{ id: 'repo-1' }]);

    const result = await repositoryFor(db).listPresentRepositories(10n);

    expect(db.githubRepository.findMany).toHaveBeenCalledWith({
      where: {
        githubOrganizationId: 10n,
        source: 'ORG_PROVISIONED',
        presence: 'PRESENT',
      },
    });
    expect(result).toEqual([{ id: 'repo-1' }]);
  });

  it('listExternalRepositories는 EXTERNAL_PUBLIC이면서 PRESENT인 저장소만 읽는다', async () => {
    const db = createDb();
    db.githubRepository.findMany.mockResolvedValue([{ id: 'ext-1' }]);

    const result = await repositoryFor(db).listExternalRepositories();

    expect(db.githubRepository.findMany).toHaveBeenCalledWith({
      where: { source: 'EXTERNAL_PUBLIC', presence: 'PRESENT' },
    });
    expect(result).toEqual([{ id: 'ext-1' }]);
  });
});

describe('CollectionIncrementalRepository — GR-6 external 저장소는 org ABSENT sweep에서 살아남는다', () => {
  /**
   * 회귀 테스트: `markAbsentRepositories`/`listPresentRepositories`의 `where` 절에서
   * `source: 'ORG_PROVISIONED'` 필터를 빼면 이 테스트가 fail한다. mock을 단순히
   * "어떤 인자로 호출됐는지"만 기록하는 게 아니라, seed된 행 배열에 대해 실제로
   * `where` 절을 적용하는 fake Prisma delegate(`createFakeGithubRepositoryStore`)를
   * 써서 검증한다 — external 행의 `githubOrganizationId`를 org sweep과 **똑같은 값**으로
   * seed해, 이 테스트가 "external 행은 githubOrganizationId가 null이라서 우연히 살아남는다"가
   * 아니라 "source 필터가 실제로 막아준다"를 증명하도록 한다.
   */
  it('markAbsentRepositories는 organization installation listing에 없는 EXTERNAL_PUBLIC 저장소를 ABSENT로 바꾸지 않는다', async () => {
    const store = createFakeGithubRepositoryStore([
      {
        id: 'org-kept',
        githubOrganizationId: 10n,
        githubRepositoryId: 1n,
        presence: 'PRESENT',
        source: 'ORG_PROVISIONED',
      },
      {
        id: 'org-removed',
        githubOrganizationId: 10n,
        githubRepositoryId: 2n,
        presence: 'PRESENT',
        source: 'ORG_PROVISIONED',
      },
      {
        id: 'ext-untouched',
        githubOrganizationId: 10n, // org sweep과 동일한 조직 id로 seed — source 필터만이 이 행을 지킨다.
        githubRepositoryId: 99n,
        presence: 'PRESENT',
        source: 'EXTERNAL_PUBLIC',
      },
    ]);
    const db = createDb();
    db.githubRepository.updateMany = store.updateMany;

    // 이번 org installation listing에는 repo 1만 관찰됨(repo 2는 조직에서 제거됨).
    // external 행(99)은 애초에 org listing에 나타나지 않으므로 관찰 목록에서 빠진다.
    await repositoryFor(db).markAbsentRepositories(
      10n,
      [1n],
      new Date('2026-08-01T00:00:00.000Z'),
    );

    const external = store.rows.find((row) => row.id === 'ext-untouched');
    const removedOrgRepo = store.rows.find((row) => row.id === 'org-removed');
    const keptOrgRepo = store.rows.find((row) => row.id === 'org-kept');
    expect(external?.presence).toBe('PRESENT');
    expect(removedOrgRepo?.presence).toBe('ABSENT');
    expect(keptOrgRepo?.presence).toBe('PRESENT');
  });

  it('listPresentRepositories는 같은 조직 id를 가진 EXTERNAL_PUBLIC 저장소를 반환하지 않는다', async () => {
    const store = createFakeGithubRepositoryStore([
      {
        id: 'org-1',
        githubOrganizationId: 10n,
        githubRepositoryId: 1n,
        presence: 'PRESENT',
        source: 'ORG_PROVISIONED',
      },
      {
        id: 'ext-1',
        githubOrganizationId: 10n,
        githubRepositoryId: 99n,
        presence: 'PRESENT',
        source: 'EXTERNAL_PUBLIC',
      },
    ]);
    const db = createDb();
    db.githubRepository.findMany = store.findMany;

    const result = await repositoryFor(db).listPresentRepositories(10n);

    expect(result.map((row) => (row as unknown as FakeRepoRow).id)).toEqual([
      'org-1',
    ]);
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
        scope: 'org:jnu-swcu',
        ownerId: 'owner-1',
        epoch: 1n,
        runId: 'run-1',
        expiresAt,
      },
    ]);

    const token = await repositoryFor(db).acquireSyncLease({
      appId: 1n,
      scope: 'org:jnu-swcu',
      ownerId: 'owner-1',
      runId: 'run-1',
      now,
      expiresAt,
    });

    expect(token?.runId).toBe('run-1');
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "CollectionSyncLease"'),
      1n,
      'org:jnu-swcu',
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
      scope: 'org:jnu-swcu',
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
          scope: 'org:jnu-swcu',
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
          scope: 'org:jnu-swcu',
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
        scope: 'org:jnu-swcu',
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
      'org:jnu-swcu',
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
          scope: 'org:jnu-swcu',
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
          scope: 'org:jnu-swcu',
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
      'org:jnu-swcu',
      'owner-1',
      1n,
      'run-1',
      now,
    );
  });
});

// #511 — sync 실행 이력을 신규 테이블 없이 lease/cursor/stream 프로젝션으로 답한다.
describe('CollectionIncrementalRepository — #511 실행 이력 프로젝션', () => {
  const at = new Date('2026-08-04T01:00:00.000Z');

  const leaseRow = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    appId: 1n,
    scope: 'org:jnu-swcu',
    ownerId: 'scheduler:11111111-2222-3333-4444-555555555555',
    runId: 'run-1',
    expiresAt: new Date('2026-08-04T00:50:00.000Z'),
    updatedAt: new Date('2026-08-04T00:45:00.000Z'),
    ...overrides,
  });

  it('lease가 없으면 빈 목록을 돌려주고 추가 질의를 하지 않는다', async () => {
    const db = createDb();

    await expect(repositoryFor(db).listSyncRuns(at, 20)).resolves.toEqual([]);
    expect(db.collectionSyncCursor.findMany).not.toHaveBeenCalled();
    expect(db.collectionRepositoryStream.groupBy).not.toHaveBeenCalled();
  });

  it('만료된 lease + 오류 없는 stream은 COMPLETED이고 ownerId는 trigger 분류로만 노출한다', async () => {
    const db = createDb();
    db.collectionSyncLease.findMany.mockResolvedValue([leaseRow()]);
    db.collectionSyncCursor.findMany.mockResolvedValue([
      {
        appId: 1n,
        scope: 'org:jnu-swcu',
        cycleStartedAt: new Date('2026-08-04T00:40:00.000Z'),
        cycleCompletedAt: new Date('2026-08-04T00:44:00.000Z'),
      },
    ]);
    db.collectionRepositoryStream.groupBy.mockImplementation(
      (args: { by: readonly string[] }) =>
        args.by[0] === 'status'
          ? Promise.resolve([{ status: 'READY', _count: { _all: 27 } }])
          : Promise.resolve([]),
    );

    const [run] = await repositoryFor(db).listSyncRuns(at, 20);

    expect(run).toEqual({
      runId: 'run-1',
      scope: 'org:jnu-swcu',
      trigger: 'CRON',
      status: 'COMPLETED',
      startedAt: new Date('2026-08-04T00:40:00.000Z'),
      lastObservedAt: new Date('2026-08-04T00:45:00.000Z'),
      cycleCompletedAt: new Date('2026-08-04T00:44:00.000Z'),
      streams: {
        readyCount: 27,
        backfillingCount: 0,
        pendingCount: 0,
        verifyingCount: 0,
        failedCount: 0,
      },
      errorCodes: [],
    });
    expect(JSON.stringify(run)).not.toContain('scheduler:');
  });

  it('아직 만료되지 않은 lease는 RUNNING으로 판정한다', async () => {
    const db = createDb();
    db.collectionSyncLease.findMany.mockResolvedValue([
      leaseRow({
        ownerId: 'admin:aaaa',
        expiresAt: new Date('2026-08-04T01:10:00.000Z'),
      }),
    ]);

    const [run] = await repositoryFor(db).listSyncRuns(at, 20);

    expect(run?.status).toBe('RUNNING');
    expect(run?.trigger).toBe('MANUAL');
  });

  it('stream에 lastErrorCode가 남아 있으면 FAILED로 판정하고 코드를 노출한다', async () => {
    const db = createDb();
    db.collectionSyncLease.findMany.mockResolvedValue([leaseRow()]);
    db.collectionRepositoryStream.groupBy.mockImplementation(
      (args: { by: readonly string[] }) =>
        args.by[0] === 'status'
          ? Promise.resolve([{ status: 'READY', _count: { _all: 2 } }])
          : Promise.resolve([
              { lastErrorCode: 'STREAM_SYNC_FAILED', _count: { _all: 3 } },
            ]),
    );

    const [run] = await repositoryFor(db).listSyncRuns(at, 20);

    expect(run?.status).toBe('FAILED');
    expect(run?.streams.failedCount).toBe(3);
    expect(run?.errorCodes).toEqual(['STREAM_SYNC_FAILED']);
  });

  it('external scope의 stream 요약은 EXTERNAL_PUBLIC 저장소만 센다', async () => {
    const db = createDb();
    db.collectionSyncLease.findMany.mockResolvedValue([
      leaseRow({ scope: 'external', ownerId: 'cli:zzzz' }),
    ]);

    const [run] = await repositoryFor(db).listSyncRuns(at, 20);

    expect(run?.trigger).toBe('CLI');
    const calls =
      db.collectionRepositoryStream.groupBy.mock.calls.flat() as Array<{
        where: { repository: { source: string } };
      }>;
    expect(calls).not.toHaveLength(0);
    for (const args of calls) {
      expect(args.where.repository.source).toBe('EXTERNAL_PUBLIC');
    }
  });
});

// #546 — repo 단위 실패가 stream에 남아야 system-status가 FAILED를 판정할 수 있다.
describe('CollectionIncrementalRepository — #546 stream 오류 표시', () => {
  const at = new Date('2026-08-04T01:00:00.000Z');

  it('오류 기록은 upsert라 stream 행이 아직 없어도 남고, frontier/status는 건드리지 않는다', async () => {
    const db = createDb();

    await repositoryFor(db).markStreamErrorState('repo-1', 'COMMIT', {
      lastErrorAt: at,
      lastErrorCode: 'PROVIDER_UPSTREAM',
    });

    expect(db.collectionRepositoryStream.updateMany).not.toHaveBeenCalled();
    const [args] = db.collectionRepositoryStream.upsert.mock.calls.flat() as [
      { create: Record<string, unknown>; update: Record<string, unknown> },
    ];
    expect(args.create).toMatchObject({
      status: 'PENDING',
      lastErrorCode: 'PROVIDER_UPSTREAM',
      lastErrorAt: at,
    });
    expect(args.update).toEqual({
      lastErrorAt: at,
      lastErrorCode: 'PROVIDER_UPSTREAM',
    });
  });

  it('오류 해제는 표시가 남아 있는 행만 갱신하고 새 행을 만들지 않는다', async () => {
    const db = createDb();

    await repositoryFor(db).markStreamErrorState('repo-1', 'RELEASE', {
      lastErrorAt: null,
      lastErrorCode: null,
    });

    expect(db.collectionRepositoryStream.upsert).not.toHaveBeenCalled();
    expect(db.collectionRepositoryStream.updateMany).toHaveBeenCalledWith({
      where: {
        repositoryId: 'repo-1',
        streamType: 'RELEASE',
        lastErrorCode: { not: null },
      },
      data: { lastErrorAt: null, lastErrorCode: null },
    });
  });
});
