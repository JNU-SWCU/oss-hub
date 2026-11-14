import { PlatformRepository } from '../platform/platform.repository';
import type { CollectionContribution } from './collection-app.client';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import type { PrismaService } from '../platform/prisma.service';

interface MockDb {
  githubRepository: {
    createMany: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    findMany: jest.Mock;
  };
  repo: { findMany: jest.Mock; findFirst: jest.Mock };
  $executeRaw: jest.Mock;
  $queryRaw: jest.Mock;
  collectionSyncLease: { findMany: jest.Mock };
  $transaction: jest.Mock;
  $queryRawUnsafe: jest.Mock;
  $executeRawUnsafe: jest.Mock;
}

const createDb = (): MockDb => {
  const db: MockDb = {
    githubRepository: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    repo: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest
      .fn()
      .mockResolvedValue([
        { candidates: 1, missing_repo: 0, inserted: 1, author_filled: 0 },
      ]),
    collectionSyncLease: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (tx: MockDb) => Promise<unknown>) =>
      fn({ ...db, $transaction: undefined } as unknown as MockDb),
    ),
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  };
  return db;
};

const repositoryFor = (db: MockDb): CollectionIncrementalRepository =>
  new CollectionIncrementalRepository(
    db as unknown as PrismaService,
    new PlatformRepository(),
  );

const sqlOf = (call: readonly unknown[]): string => {
  const [query] = call;
  return Array.isArray(query) ? query.join('') : '';
};

const fact = (
  githubKey: string,
  authorGithubId: string | null = '7',
): CollectionContribution => ({
  githubKey,
  authorGithubId,
  occurredAt: new Date('2026-11-14T08:00:00.000Z'),
});

describe('CollectionIncrementalRepository — 외부 저장소 편입', () => {
  it('external 저장소를 현재 관찰로 복구하고 repo 원장에 같이 쓴다', async () => {
    const db = createDb();
    const observedAt = new Date('2026-08-09T14:00:00.000Z');

    await expect(
      repositoryFor(db).enrollExternalRepository({
        githubRepositoryId: 42n,
        nameWithOwner: 'synthetic-student/synthetic-own-repo',
        defaultBranch: 'main',
        archived: false,
        observedAt,
      }),
    ).resolves.toBe(true);

    expect(db.githubRepository.updateMany).toHaveBeenCalledWith({
      where: { githubRepositoryId: 42n, source: 'EXTERNAL_PUBLIC' },
      data: {
        nameWithOwner: 'synthetic-student/synthetic-own-repo',
        defaultBranch: 'main',
        archived: false,
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        lastCompleteInventoryObservedAt: observedAt,
      },
    });
    const ledger = db.$executeRaw.mock.calls.map(sqlOf);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toContain('INSERT INTO "repo"');
    expect(ledger[0]).not.toContain('last_success_at');
  });

  it('편입할 external 행이 없으면 원장을 쓰지 않는다', async () => {
    const db = createDb();
    db.githubRepository.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repositoryFor(db).enrollExternalRepository({
        githubRepositoryId: 42n,
        nameWithOwner: 'a/b',
        defaultBranch: null,
        archived: false,
        observedAt: new Date(),
      }),
    ).resolves.toBe(false);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('CollectionIncrementalRepository — recordContributions', () => {
  it('빈 배열은 DB를 건드리지 않는다', async () => {
    const db = createDb();

    await expect(
      repositoryFor(db).recordContributions(42n, 'commit', []),
    ).resolves.toEqual({ inserted: 0, authorFilled: 0 });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('repo 행이 있는 저장소에만 contribution 한 문장으로 넣어 삽입·작성자 채움 개수를 돌려준다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([
      { candidates: 2, missing_repo: 0, inserted: 1, author_filled: 1 },
    ]);

    await expect(
      repositoryFor(db).recordContributions(42n, 'pull_request', [
        fact('1'),
        fact('2'),
      ]),
    ).resolves.toEqual({ inserted: 1, authorFilled: 1 });

    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = sqlOf(db.$queryRaw.mock.calls[0] as unknown[]);
    expect(sql).not.toContain('INSERT INTO "repo"');
    expect(sql).not.toContain('GithubRepository');
    expect(sql).toContain('FROM "repo" AS existing');
    expect(sql).toContain('INSERT INTO "contribution"');
    expect(sql).toContain(
      'ON CONFLICT ("repo_id", "kind", "github_key") DO UPDATE',
    );
    expect(sql).toContain('WHERE "contribution"."author_github_id" IS NULL');
    expect(sql).toContain('AND EXCLUDED."author_github_id" IS NOT NULL');
    expect(sql).not.toContain('last_success_at');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('작성자를 모르는 기여도 행으로 남긴다', async () => {
    const db = createDb();

    await repositoryFor(db).recordContributions(42n, 'commit', [
      fact('sha', null),
    ]);

    const values = (db.$queryRaw.mock.calls[0] as unknown[]).slice(1);
    expect(
      JSON.stringify(values, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ).toContain('"sha"');
  });

  it.each([
    [{ candidates: 1, missing_repo: 1, inserted: 0, author_filled: 0 }],
    [{ candidates: 0, missing_repo: 0, inserted: 0, author_filled: 0 }],
  ])('repo 행을 찾지 못하면 던져 트랜잭션을 되돌린다 (%o)', async (summary) => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([summary]);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(
      repositoryFor(db).recordContributions(42n, 'issue', [fact('1')]),
    ).rejects.toThrow('contribution repository row is missing');
  });

  it('요약 행 모양이 다르면 던진다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([{ candidates: '1' }]);

    await expect(
      repositoryFor(db).recordContributions(42n, 'release', [fact('1')]),
    ).rejects.toThrow('contribution insert summary was not an integer');
  });

  it('이미 열린 트랜잭션 안에서는 그 클라이언트에 쓴다', async () => {
    const db = createDb();

    await repositoryFor(db).runInTransaction((store) =>
      store.recordContributions(42n, 'commit', [fact('1')]),
    );

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('CollectionIncrementalRepository — recordRepositorySuccess', () => {
  it('빈 목록은 쓰지 않는다', async () => {
    const db = createDb();

    await repositoryFor(db).recordRepositorySuccess([], new Date());

    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('repo.last_success_at만 한 문장으로 올린다', async () => {
    const db = createDb();
    const at = new Date('2026-11-14T09:55:00.000Z');

    await repositoryFor(db).recordRepositorySuccess([1n, 2n], at);

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    const [query, ...values] = db.$executeRaw.mock.calls[0] as unknown[];
    const sql = sqlOf([query]);
    expect(sql).toContain('UPDATE "repo"');
    expect(sql).toContain('SET "last_success_at" =');
    expect(sql).not.toContain('GithubRepository');
    expect(values).toEqual([at, expect.anything()]);
  });
});

describe('CollectionIncrementalRepository — listCollectionTargets', () => {
  it('열린 팀 연결이 있는 repo 행을 수집 대상으로 last_success_at과 함께 돌려준다', async () => {
    const db = createDb();
    const at = new Date('2026-11-14T09:00:00.000Z');
    db.repo.findMany.mockResolvedValue([
      {
        githubRepoId: 1n,
        ownerName: 'org/one',
        defaultBranch: 'main',
        archived: false,
        visibility: 'PRIVATE',
        presence: 'PRESENT',
        source: 'ORG_PROVISIONED',
        teamRepos: [{ teamId: 'team-1' }],
        lastSuccessAt: at,
      },
    ]);

    await expect(
      repositoryFor(db).listCollectionTargets('ORG_PROVISIONED'),
    ).resolves.toEqual([
      {
        githubRepositoryId: 1n,
        nameWithOwner: 'org/one',
        defaultBranch: 'main',
        archived: false,
        visibility: 'PRIVATE',
        presence: 'PRESENT',
        source: 'ORG_PROVISIONED',
        teamId: 'team-1',
        lastSuccessAt: at,
      },
    ]);
    expect(db.repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          source: 'ORG_PROVISIONED',
          presence: 'PRESENT',
          teamRepos: {
            some: {
              validTo: null,
              team: { program: { lifecycle: { not: 'DELETED' } } },
            },
          },
        },
        orderBy: { githubRepoId: 'asc' },
      }),
    );
    expect(db.githubRepository.findMany).not.toHaveBeenCalled();
  });

  it('external 수집 대상은 공개 저장소만이다', async () => {
    const db = createDb();

    await repositoryFor(db).listCollectionTargets('EXTERNAL_PUBLIC');

    expect(db.repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: 'EXTERNAL_PUBLIC',
          visibility: 'PUBLIC',
        }) as unknown,
      }),
    );
  });
});

describe('CollectionIncrementalRepository — transactional scope', () => {
  it('트랜잭션 내부의 조회 결과를 반환한다', async () => {
    const db = createDb();
    db.repo.findFirst.mockResolvedValue({
      githubRepoId: 20n,
      ownerName: 'org/twenty',
      defaultBranch: null,
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      source: 'EXTERNAL_PUBLIC',
      teamRepos: [],
    });
    const result = await repositoryFor(db).runInTransaction((repo) =>
      repo.findCollectionTargetByLogicalKey(20n),
    );
    expect(result).toEqual(
      expect.objectContaining({ githubRepositoryId: 20n, teamId: null }),
    );
  });

  it('트랜잭션 내부 실패를 호출자에게 전달한다', async () => {
    const db = createDb();
    db.repo.findFirst.mockRejectedValue(new Error('boom'));
    await expect(
      repositoryFor(db).runInTransaction((repo) =>
        repo.findCollectionTargetByLogicalKey(20n),
      ),
    ).rejects.toThrow('boom');
  });
});

describe('CollectionIncrementalRepository — 새해 특수 처리가 사라졌다', () => {
  it('연도 집계 reader 가 더 이상 존재하지 않는다', () => {
    const repository = repositoryFor(createDb()) as unknown as Record<
      string,
      unknown
    >;

    expect(repository.getRepositoryYearAggregate).toBeUndefined();
    expect(repository.getContributorYearAggregate).toBeUndefined();
    expect(repository.rebuildAffectedAggregates).toBeUndefined();
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
