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
  repo: { findMany: jest.Mock };
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
    repo: { findMany: jest.fn().mockResolvedValue([]) },
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

interface FakeRepoRow {
  readonly team?: { readonly program: { readonly lifecycle: string } };
  teamId: string | null;
  id: string;
  githubOrganizationId: bigint | null;
  githubRepositoryId: bigint;
  presence: 'PRESENT' | 'ABSENT';
  source: 'ORG_PROVISIONED' | 'EXTERNAL_PUBLIC';
}

function matchesWhere(row: object, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'NOT' && Array.isArray(condition)) {
      return condition.every(
        (nested: Record<string, unknown>) => !matchesWhere(row, nested),
      );
    }
    const value = (row as unknown as Record<string, unknown>)[key];
    if (
      condition !== null &&
      typeof condition === 'object' &&
      'not' in condition
    ) {
      return value !== condition.not;
    }
    if (
      condition !== null &&
      typeof condition === 'object' &&
      'notIn' in (condition as Record<string, unknown>)
    ) {
      const notIn = (condition as { notIn: readonly unknown[] }).notIn;
      return !notIn.includes(value);
    }
    if (
      value !== null &&
      typeof value === 'object' &&
      condition !== null &&
      typeof condition === 'object'
    )
      return matchesWhere(value, condition as Record<string, unknown>);
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
      repositoryFor(db).recordContributions('repo-1', 'commit', []),
    ).resolves.toEqual({ inserted: 0, authorFilled: 0 });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('repo 행을 보장하고 contribution 한 문장으로 넣어 삽입·작성자 채움 개수를 돌려준다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([
      { candidates: 2, missing_repo: 0, inserted: 1, author_filled: 1 },
    ]);

    await expect(
      repositoryFor(db).recordContributions('repo-1', 'pull_request', [
        fact('1'),
        fact('2'),
      ]),
    ).resolves.toEqual({ inserted: 1, authorFilled: 1 });

    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = sqlOf(db.$queryRaw.mock.calls[0] as unknown[]);
    expect(sql).toContain('INSERT INTO "repo"');
    expect(sql).toContain('ON CONFLICT ("github_repo_id") DO NOTHING');
    expect(sql).toContain('INSERT INTO "contribution"');
    expect(sql).toContain(
      'ON CONFLICT ("repo_id", "kind", "github_key") DO UPDATE',
    );
    expect(sql).toContain('WHERE "contribution"."author_github_id" IS NULL');
    expect(sql).toContain('AND EXCLUDED."author_github_id" IS NOT NULL');
    expect(sql).not.toContain('last_success_at');
    expect(sql).not.toContain('CollectionRepositoryStream');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('작성자를 모르는 기여도 행으로 남긴다', async () => {
    const db = createDb();

    await repositoryFor(db).recordContributions('repo-1', 'commit', [
      fact('sha', null),
    ]);

    const values = (db.$queryRaw.mock.calls[0] as unknown[]).slice(1);
    expect(JSON.stringify(values)).toContain('"sha"');
  });

  it.each([
    [{ candidates: 1, missing_repo: 1, inserted: 0, author_filled: 0 }],
    [{ candidates: 0, missing_repo: 0, inserted: 0, author_filled: 0 }],
  ])('repo 행을 찾지 못하면 던져 트랜잭션을 되돌린다 (%o)', async (summary) => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([summary]);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(
      repositoryFor(db).recordContributions('repo-1', 'issue', [fact('1')]),
    ).rejects.toThrow('contribution repository row is missing');
  });

  it('요약 행 모양이 다르면 던진다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([{ candidates: '1' }]);

    await expect(
      repositoryFor(db).recordContributions('repo-1', 'release', [fact('1')]),
    ).rejects.toThrow('contribution insert summary was not an integer');
  });

  it('이미 열린 트랜잭션 안에서는 그 클라이언트에 쓴다', async () => {
    const db = createDb();

    await repositoryFor(db).runInTransaction((store) =>
      store.recordContributions('repo-1', 'commit', [fact('1')]),
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
  it('출처별 수집 대상에 repo.last_success_at을 붙여 돌려준다', async () => {
    const db = createDb();
    const at = new Date('2026-11-14T09:00:00.000Z');
    db.githubRepository.findMany.mockResolvedValue([
      { id: 'r1', githubRepositoryId: 1n },
      { id: 'r2', githubRepositoryId: 2n },
    ]);
    db.repo.findMany.mockResolvedValue([
      { githubRepoId: 1n, lastSuccessAt: at },
    ]);

    await expect(
      repositoryFor(db).listCollectionTargets('ORG_PROVISIONED'),
    ).resolves.toEqual([
      { id: 'r1', githubRepositoryId: 1n, lastSuccessAt: at },
      { id: 'r2', githubRepositoryId: 2n, lastSuccessAt: null },
    ]);
    expect(db.githubRepository.findMany).toHaveBeenCalledWith({
      where: {
        source: 'ORG_PROVISIONED',
        presence: 'PRESENT',
        teamId: { not: null },
        team: { program: { lifecycle: { not: 'DELETED' } } },
      },
      orderBy: { githubRepositoryId: 'asc' },
    });
    expect(db.repo.findMany).toHaveBeenCalledWith({
      where: { githubRepoId: { in: [1n, 2n] } },
      select: { githubRepoId: true, lastSuccessAt: true },
    });
  });

  it('external 수집 대상은 공개 저장소만이다', async () => {
    const db = createDb();

    await repositoryFor(db).listCollectionTargets('EXTERNAL_PUBLIC');

    expect(db.githubRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: 'EXTERNAL_PUBLIC',
          visibility: 'PUBLIC',
        }) as unknown,
      }),
    );
  });

  it('조직 조회는 같은 조직 ID를 가진 외부 저장소와 사라진 저장소를 반환하지 않는다', async () => {
    const store = createFakeGithubRepositoryStore([
      {
        id: 'org-1',
        teamId: 'team-1',
        team: { program: { lifecycle: 'PUBLISHED' } },
        githubOrganizationId: 10n,
        githubRepositoryId: 1n,
        presence: 'PRESENT',
        source: 'ORG_PROVISIONED',
      },
      {
        id: 'org-gone',
        teamId: 'team-3',
        team: { program: { lifecycle: 'PUBLISHED' } },
        githubOrganizationId: 10n,
        githubRepositoryId: 3n,
        presence: 'ABSENT',
        source: 'ORG_PROVISIONED',
      },
      {
        id: 'ext-1',
        teamId: 'team-2',
        team: { program: { lifecycle: 'PUBLISHED' } },
        githubOrganizationId: 10n,
        githubRepositoryId: 99n,
        presence: 'PRESENT',
        source: 'EXTERNAL_PUBLIC',
      },
    ]);
    const db = createDb();
    db.githubRepository.findMany = store.findMany;

    const result =
      await repositoryFor(db).listCollectionTargets('ORG_PROVISIONED');

    expect(result.map((row) => row.id)).toEqual(['org-1']);
  });
});

describe('CollectionIncrementalRepository — transactional scope', () => {
  it('트랜잭션 내부의 조회 결과를 반환한다', async () => {
    const db = createDb();
    db.githubRepository.findUnique.mockResolvedValue({ id: 'repo-1' });
    const result = await repositoryFor(db).runInTransaction((repo) =>
      repo.findRepositoryByLogicalKey(20n),
    );
    expect(result).toEqual({ id: 'repo-1' });
  });

  it('트랜잭션 내부 실패를 호출자에게 전달한다', async () => {
    const db = createDb();
    db.githubRepository.findUnique.mockRejectedValue(new Error('boom'));
    await expect(
      repositoryFor(db).runInTransaction((repo) =>
        repo.findRepositoryByLogicalKey(20n),
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
