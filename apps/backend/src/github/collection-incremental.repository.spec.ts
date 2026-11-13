import { Prisma } from '@prisma/client';
import { PlatformRepository } from '../platform/platform.repository';
import { StaleSyncEpochError } from './collection-incremental.error';
import { CollectionIncrementalRepository } from './collection-incremental.repository';
import type { PrismaService } from '../platform/prisma.service';

const stringifyWithBigint = (value: unknown): string => {
  const text = JSON.stringify(value, (_key: string, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
  if (typeof text !== 'string') {
    throw new Error('serialized query calls were empty');
  }
  return text;
};

interface MockDb {
  githubRepository: {
    upsert: jest.Mock;
    create: jest.Mock;
    createMany: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    findMany: jest.Mock;
  };
  $executeRaw: jest.Mock;
  $queryRaw: jest.Mock;
  user: { findMany: jest.Mock };
  collectionRepositoryStream: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
    groupBy: jest.Mock;
    updateMany: jest.Mock;
    updateManyAndReturn: jest.Mock;
    create: jest.Mock;
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

const createDb = (): MockDb => {
  const db: MockDb = {
    githubRepository: {
      upsert: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest
      .fn()
      .mockResolvedValue([
        { candidates: 1000000, missing_repo: 0, inserted: 0 },
      ]),

    user: {
      findMany: jest.fn(
        ({ where }: { where: { githubId: { in: readonly bigint[] } } }) =>
          Promise.resolve(where.githubId.in.map((githubId) => ({ githubId }))),
      ),
    },
    collectionRepositoryStream: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateManyAndReturn: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
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
  new CollectionIncrementalRepository(
    db as unknown as PrismaService,
    new PlatformRepository(),
  );

const executeRawSql = (call: readonly unknown[]): string => {
  const [query] = call;
  if (Array.isArray(query)) return query.join('');
  return '';
};

const queryTexts = (calls: readonly (readonly unknown[])[]): string[] =>
  calls.map((call) => executeRawSql(call));

const expectLedgerInsert = (db: MockDb): void => {
  const ledger = queryTexts(db.$queryRaw.mock.calls as (readonly unknown[])[]);
  expect(
    ledger.filter(
      (sql) =>
        sql.includes('INSERT INTO "contribution"') &&
        sql.includes('INSERT INTO "repo"') &&
        sql.includes('ON CONFLICT ("github_repo_id") DO NOTHING') &&
        sql.includes('CURRENT_TIMESTAMP AS first_seen_at') &&
        sql.includes('ON CONFLICT ("repo_id", "kind", "github_key")') &&
        !sql.includes('CollectionCommitFact') &&
        !sql.includes('INSERT INTO "Contribution"'),
    ),
  ).toHaveLength(1);
  expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  expect(db.$executeRaw).not.toHaveBeenCalled();
};
const DEFAULT_REGISTERED_GITHUB_IDS = new Set([1n, 2n, 42n, 99n]);

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

describe('CollectionIncrementalRepository — repository identity', () => {
  it('가입자 GitHub ID를 한 번에 읽어 불변 집합으로 돌려준다', async () => {
    const db = createDb();
    db.user.findMany.mockResolvedValue([
      { githubId: 2n },
      { githubId: 1n },
      { githubId: 2n },
    ]);

    const result = await repositoryFor(db).listRegisteredGithubIds();

    expect(result).toEqual(new Set([1n, 2n]));
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    expect(db.user.findMany).toHaveBeenCalledWith({
      select: { githubId: true },
    });
  });

  it('OWN 저장소를 경쟁 안전하게 편입하고 기존 external 상태도 현재 관찰로 복구한다', async () => {
    const db = createDb();
    db.githubRepository.createMany.mockResolvedValue({ count: 1 });
    db.githubRepository.updateMany.mockResolvedValue({ count: 1 });
    const observedAt = new Date('2026-08-09T14:00:00.000Z');

    await repositoryFor(db).enrollExternalRepository({
      githubRepositoryId: 42n,
      nameWithOwner: 'synthetic-student/synthetic-own-repo',
      defaultBranch: 'main',
      archived: false,
      observedAt,
    });

    expect(db.githubRepository.createMany).not.toHaveBeenCalled();
    const updateCalls = db.githubRepository.updateMany.mock
      .calls as unknown as ReadonlyArray<
      readonly [
        {
          readonly where: Record<string, unknown>;
          readonly data: Record<string, unknown>;
        },
      ]
    >;
    expect(updateCalls[0]?.[0]).toEqual({
      where: {
        githubRepositoryId: 42n,
        source: 'EXTERNAL_PUBLIC',
      },
      data: {
        nameWithOwner: 'synthetic-student/synthetic-own-repo',
        defaultBranch: 'main',
        archived: false,
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        lastCompleteInventoryObservedAt: observedAt,
        nextRunAt: observedAt,
        failureCount: 0,
      },
    });
  });
});

describe('CollectionIncrementalRepository — commit facts (deterministic rebuild)', () => {
  it('contribution에 넣고 실제 삽입 개수를 반환한다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([
      { candidates: 1000000, missing_repo: 0, inserted: 1 },
    ]);

    const result = await repositoryFor(db).recordCommitFacts(
      'repo-1',
      [
        {
          sha: 'abc',
          committedAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 99n,
          authorGithubLogin: 'octocat',
        },
      ],
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    expect(result.insertedCount).toBe(1);
    expectLedgerInsert(db);
    expect(stringifyWithBigint(db.$queryRaw.mock.calls)).toContain('commit');
  });

  it('옛 사실 테이블과 일별 Contribution은 다시 쓰지 않는다', async () => {
    const db = createDb();

    await repositoryFor(db).recordCommitFacts(
      'repo-1',
      [
        {
          sha: 'snapshot-member',
          committedAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 99n,
        },
      ],
      new Set([99n]),
    );

    expectLedgerInsert(db);
    const ledger = queryTexts(
      db.$queryRaw.mock.calls as (readonly unknown[])[],
    ).join('\n');
    expect(ledger).not.toContain('JOIN "User"');
    expect(ledger).not.toContain('"CollectionCommitFact"');
  });

  it('빈 배열은 DB를 건드리지 않고 0을 반환한다', async () => {
    const db = createDb();

    const result = await repositoryFor(db).recordCommitFacts(
      'repo-1',
      [],
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    expect(result).toEqual({ acceptedCount: 0, insertedCount: 0 });
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('원장 INSERT는 옛 사실 COUNT에 기대지 않는다', async () => {
    const db = createDb();

    await repositoryFor(db).recordCommitFacts(
      'repo-1',
      [
        {
          sha: 'retry',
          committedAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 1n,
        },
      ],
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    expectLedgerInsert(db);
  });

  it('두 명의 기여자가 같은 배치에 섞여도 각자의 contributor 집계로 분리된다', async () => {
    const db = createDb();

    await repositoryFor(db).recordCommitFacts(
      'repo-1',
      [
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
      ],
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    expectLedgerInsert(db);
  });

  it('author가 null인 fact 는 어떤 행도 만들지 않는다 — 귀속을 모르는 기여는 적재하지 않는다', async () => {
    const db = createDb();

    await repositoryFor(db).recordCommitFacts(
      'repo-1',
      [{ sha: 'anon', committedAt: new Date('2026-03-01T00:00:00.000Z') }],
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('날짜 경계를 넘나드는 배치는 각 날짜의 칸을 따로 재계산한다(Asia/Seoul 기준)', async () => {
    const db = createDb();

    await repositoryFor(db).recordCommitFacts(
      'repo-1',
      [
        {
          sha: 'y2025',
          committedAt: new Date('2025-12-31T14:30:00.000Z'),
          authorGithubId: 1n,
        },

        {
          sha: 'y2026',
          committedAt: new Date('2025-12-31T15:30:00.000Z'),
          authorGithubId: 1n,
        },
      ],
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    expectLedgerInsert(db);
  });

  it('같은 커밋을 다시 적어도 contribution은 ON CONFLICT이고 repo 행은 만든다', async () => {
    const db = createDb();
    const facts = [
      {
        sha: 'abc',
        committedAt: new Date('2026-03-01T00:00:00.000Z'),
        authorGithubId: 99n,
        authorGithubLogin: 'octocat',
      },
    ];

    await repositoryFor(db).recordCommitFacts(
      'repo-1',
      facts,
      DEFAULT_REGISTERED_GITHUB_IDS,
    );
    await repositoryFor(db).recordCommitFacts(
      'repo-1',
      facts,
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    const ledger = queryTexts(
      db.$queryRaw.mock.calls as (readonly unknown[])[],
    ).filter((sql) => sql.includes('INSERT INTO "contribution"'));
    expect(ledger).toHaveLength(2);
    for (const sql of ledger) {
      expect(sql).toContain('INSERT INTO "repo"');
      expect(sql).toContain('ON CONFLICT ("github_repo_id") DO NOTHING');
      expect(sql).toContain('ON CONFLICT ("repo_id", "kind", "github_key")');
      expect(sql).toContain('CURRENT_TIMESTAMP AS first_seen_at');
      expect(sql).not.toContain('"CollectionCommitFact"');
      expect(sql).not.toContain('team_repo');
    }
  });

  it('저장소 행을 만들 수 없으면 contribution 트랜잭션을 되돌린다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([
      { candidates: 0, missing_repo: 1, inserted: 0 },
    ]);
    const debugLines: string[] = [];
    const debug = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        debugLines.push(String(chunk));
        return true;
      });

    await expect(
      repositoryFor(db).recordCommitFacts(
        'repo-1',
        [
          {
            sha: 'missing-repo',
            committedAt: new Date('2026-03-01T00:00:00.000Z'),
            authorGithubId: 99n,
            authorGithubLogin: 'octocat',
          },
        ],
        DEFAULT_REGISTERED_GITHUB_IDS,
      ),
    ).rejects.toThrow('contribution repository row is missing');
    const ledger = queryTexts(
      db.$queryRaw.mock.calls as (readonly unknown[])[],
    ).filter((sql) => sql.includes('INSERT INTO "contribution"'));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toContain('INSERT INTO "repo"');
    expect(ledger[0]).toContain('CURRENT_TIMESTAMP AS first_seen_at');
    expect(ledger[0]).not.toContain('"CollectionCommitFact"');
    expect(debugLines).toContain(
      `${JSON.stringify({
        level: 'debug',
        event: 'collection.ledger.contribution_skipped_missing_repo',
        kind: 'commit',
        missingRepoCount: 1,
        candidateCount: 0,
      })}\n`,
    );
    debug.mockRestore();
  });

  it('이미 열린 트랜잭션 안에서는 사실과 contribution을 그 클라이언트에 쓴다', async () => {
    const db = createDb();
    db.$transaction = undefined as unknown as jest.Mock;

    await repositoryFor(db).recordCommitFacts(
      'repo-1',
      [
        {
          sha: 'inside-tx',
          committedAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 99n,
        },
      ],
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('CollectionIncrementalRepository — pull request facts (parity)', () => {
  it('pull request는 contribution에만 넣고 옛 사실 테이블은 쓰지 않는다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([
      { candidates: 1000000, missing_repo: 0, inserted: 1 },
    ]);

    const result = await repositoryFor(db).recordPullRequestFacts(
      'repo-1',
      [
        {
          githubPullRequestId: 7n,
          state: 'MERGED',
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          authorGithubId: 42n,
          authorGithubLogin: 'octocat',
        },
      ],
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    expect(result.insertedCount).toBe(1);
    expectLedgerInsert(db);
  });

  it('빈 배열은 DB를 건드리지 않는다', async () => {
    const db = createDb();

    const result = await repositoryFor(db).recordPullRequestFacts(
      'repo-1',
      [],
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    expect(result).toEqual({ acceptedCount: 0, insertedCount: 0 });
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('CollectionIncrementalRepository — release facts (parity)', () => {
  it('release는 contribution에만 넣고 옛 사실 테이블은 쓰지 않는다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([
      { candidates: 1000000, missing_repo: 0, inserted: 1 },
    ]);

    const result = await repositoryFor(db).recordReleaseFacts(
      'repo-1',
      [
        {
          githubReleaseId: 9n,
          publishedAt: new Date('2026-06-01T00:00:00.000Z'),
          authorGithubId: 42n,
          authorGithubLogin: 'octocat',
        },
      ],
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    expect(result.insertedCount).toBe(1);
    expectLedgerInsert(db);
  });

  it('빈 배열은 DB를 건드리지 않는다', async () => {
    const db = createDb();

    const result = await repositoryFor(db).recordReleaseFacts(
      'repo-1',
      [],
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    expect(result).toEqual({ acceptedCount: 0, insertedCount: 0 });
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('CollectionIncrementalRepository — issue facts (parity)', () => {
  it('가입자 issue만 contribution에 넣고 옛 이력은 쓰지 않는다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([
      { candidates: 1000000, missing_repo: 0, inserted: 1 },
    ]);
    const createdAt = new Date('2026-05-01T00:00:00.000Z');

    const result = await repositoryFor(db).recordIssueFacts(
      'repo-1',
      [
        {
          githubIssueId: 11n,
          state: 'open',
          createdAt,
          authorGithubId: 42n,
          authorGithubLogin: 'octocat',
        },

        { githubIssueId: 12n, state: 'open', createdAt, authorGithubId: 7n },
      ],
      DEFAULT_REGISTERED_GITHUB_IDS,
    );

    expect(result).toEqual({ acceptedCount: 1, insertedCount: 1 });
    expectLedgerInsert(db);
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

  it('등록된 조직 저장소는 조직 ID 관찰 여부와 무관하게 조회한다', async () => {
    const db = createDb();
    db.githubRepository.findMany.mockResolvedValue([{ id: 'repo-1' }]);

    const result = await repositoryFor(db).listOrganizationRepositories();

    expect(db.githubRepository.findMany).toHaveBeenCalledWith({
      where: {
        source: 'ORG_PROVISIONED',
        teamId: { not: null },
        team: { program: { lifecycle: { not: 'DELETED' } } },
      },
    });
    expect(result).toEqual([{ id: 'repo-1' }]);
  });

  it('listExternalRepositories는 신청에 연결된 외부 저장소만 읽는다', async () => {
    const db = createDb();
    db.githubRepository.findMany.mockResolvedValue([{ id: 'ext-1' }]);

    const result = await repositoryFor(db).listExternalRepositories();

    expect(db.githubRepository.findMany).toHaveBeenCalledWith({
      where: {
        source: 'EXTERNAL_PUBLIC',
        teamId: { not: null },
        team: { program: { lifecycle: { not: 'DELETED' } } },
      },
    });
    expect(result).toEqual([{ id: 'ext-1' }]);
  });
});

describe('CollectionIncrementalRepository — GR-6 external 저장소는 org ABSENT sweep에서 살아남는다', () => {
  it('조직 조회는 같은 조직 ID를 가진 외부 저장소를 반환하지 않는다', async () => {
    const store = createFakeGithubRepositoryStore([
      {
        id: 'org-1',
        teamId: 'application-1',
        team: { program: { lifecycle: 'PUBLISHED' } },
        githubOrganizationId: 10n,
        githubRepositoryId: 1n,
        presence: 'PRESENT',
        source: 'ORG_PROVISIONED',
      },
      {
        id: 'ext-1',
        teamId: 'application-2',
        team: { program: { lifecycle: 'PUBLISHED' } },
        githubOrganizationId: 10n,
        githubRepositoryId: 99n,
        presence: 'PRESENT',
        source: 'EXTERNAL_PUBLIC',
      },
    ]);
    const db = createDb();
    db.githubRepository.findMany = store.findMany;

    const result = await repositoryFor(db).listOrganizationRepositories();

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

interface StoredStream {
  repositoryId: string;
  streamType: string;
  status: string;
  frontierSha: string | null;
  frontierCreatedAt: Date | null;
  frontierEntityId: bigint | null;
  requestFingerprint: string | null;
  etag: string | null;
  lastRunAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
  syncEpoch: bigint | null;
}

const streamKey = (repositoryId: string, streamType: string): string =>
  `${repositoryId}:${streamType}`;

const installStreams = (db: MockDb): Map<string, StoredStream> => {
  const rows = new Map<string, StoredStream>();
  db.collectionRepositoryStream.findUnique.mockImplementation(
    (args: {
      where: {
        repositoryId_streamType: { repositoryId: string; streamType: string };
      };
    }) => {
      const key = args.where.repositoryId_streamType;
      return Promise.resolve(
        rows.get(streamKey(key.repositoryId, key.streamType)) ?? null,
      );
    },
  );
  db.collectionRepositoryStream.updateManyAndReturn.mockImplementation(
    (args: {
      where: {
        repositoryId: string;
        streamType: string;
        syncEpoch?: bigint | null;
      };
      data: Partial<StoredStream>;
    }) => {
      const current = rows.get(
        streamKey(args.where.repositoryId, args.where.streamType),
      );
      if (current === undefined) return Promise.resolve([]);
      if (
        'syncEpoch' in args.where &&
        current.syncEpoch !== (args.where.syncEpoch ?? null)
      ) {
        return Promise.resolve([]);
      }
      const next = { ...current, ...args.data };
      rows.set(streamKey(args.where.repositoryId, args.where.streamType), next);
      return Promise.resolve([next]);
    },
  );
  db.collectionRepositoryStream.create.mockImplementation(
    (args: { data: StoredStream }) => {
      const key = streamKey(args.data.repositoryId, args.data.streamType);
      if (rows.has(key)) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        );
      }
      const row = { ...args.data };
      rows.set(key, row);
      return Promise.resolve(row);
    },
  );
  return rows;
};

const seedStream = (
  rows: Map<string, StoredStream>,
  syncEpoch: bigint | null,
  patch: Partial<StoredStream>,
): StoredStream => {
  const row: StoredStream = {
    repositoryId: 'repo-1',
    streamType: 'COMMIT',
    status: 'READY',
    frontierSha: 'kept-sha',
    frontierCreatedAt: null,
    frontierEntityId: null,
    requestFingerprint: 'kept-fp',
    etag: 'kept-etag',
    lastRunAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    syncEpoch,
    ...patch,
  };
  rows.set(streamKey(row.repositoryId, row.streamType), row);
  return row;
};

describe('CollectionIncrementalRepository — stream sync epoch', () => {
  const at = new Date('2026-08-04T01:00:00.000Z');

  it('오류 기록은 stream 행이 없어도 남고 frontier와 status는 비워 둔다', async () => {
    const db = createDb();
    const rows = installStreams(db);

    await repositoryFor(db).markStreamOutcome(
      'repo-1',
      'COMMIT',
      { lastErrorAt: at, lastErrorCode: 'PROVIDER_UPSTREAM' },
      null,
    );

    expect(rows.get('repo-1:COMMIT')).toEqual({
      repositoryId: 'repo-1',
      streamType: 'COMMIT',
      status: 'PENDING',
      frontierSha: null,
      frontierCreatedAt: null,
      frontierEntityId: null,
      requestFingerprint: null,
      etag: null,
      lastRunAt: null,
      lastErrorAt: at,
      lastErrorCode: 'PROVIDER_UPSTREAM',
      syncEpoch: 1n,
    });
  });

  it('있던 행의 오류 기록은 frontier와 status를 유지하고 epoch를 하나 올린다', async () => {
    const db = createDb();
    const rows = installStreams(db);
    seedStream(rows, 4n, { streamType: 'COMMIT' });

    await repositoryFor(db).markStreamOutcome(
      'repo-1',
      'COMMIT',
      { lastErrorAt: at, lastErrorCode: 'PROVIDER_UPSTREAM' },
      4n,
    );

    expect(rows.get('repo-1:COMMIT')).toMatchObject({
      status: 'READY',
      frontierSha: 'kept-sha',
      requestFingerprint: 'kept-fp',
      etag: 'kept-etag',
      lastErrorAt: at,
      lastErrorCode: 'PROVIDER_UPSTREAM',
      syncEpoch: 5n,
    });
  });

  it('성공은 확인한 시각을 남기고 오류 표시를 지우며 epoch를 하나 올린다', async () => {
    const db = createDb();
    const rows = installStreams(db);
    seedStream(rows, null, {
      streamType: 'RELEASE',
      lastErrorAt: at,
      lastErrorCode: 'PROVIDER_UPSTREAM',
    });

    await repositoryFor(db).markStreamOutcome(
      'repo-1',
      'RELEASE',
      { checkedAt: at },
      null,
    );

    expect(rows.size).toBe(1);
    expect(rows.get('repo-1:RELEASE')).toMatchObject({
      lastRunAt: at,
      lastErrorAt: null,
      lastErrorCode: null,
      frontierSha: 'kept-sha',
      syncEpoch: 1n,
    });
  });

  it('성공은 행이 없으면 행을 만들지 않는다', async () => {
    const db = createDb();
    const rows = installStreams(db);

    await repositoryFor(db).markStreamOutcome(
      'repo-1',
      'RELEASE',
      { checkedAt: at },
      null,
    );

    expect(rows.size).toBe(0);
  });

  it('현재 epoch는 하나 올라가고 같은 epoch로 다시 쓰면 행이 그대로다', async () => {
    const db = createDb();
    const rows = installStreams(db);
    seedStream(rows, 4n, {});
    const repository = repositoryFor(db);

    const written = await repository.upsertStreamFrontier({
      repositoryId: 'repo-1',
      streamType: 'COMMIT',
      frontierSha: 'next-sha',
      expectedSyncEpoch: 4n,
    });

    expect(written.syncEpoch).toBe(5n);
    expect(rows.get('repo-1:COMMIT')).toMatchObject({
      frontierSha: 'next-sha',
      status: 'READY',
      syncEpoch: 5n,
    });
    const afterWrite = { ...rows.get('repo-1:COMMIT') };

    await expect(
      repository.upsertStreamFrontier({
        repositoryId: 'repo-1',
        streamType: 'COMMIT',
        frontierSha: 'stale-sha',
        expectedSyncEpoch: 4n,
      }),
    ).rejects.toBeInstanceOf(StaleSyncEpochError);
    expect(rows.get('repo-1:COMMIT')).toEqual(afterWrite);
  });

  it('비어 있는 epoch는 1이 되고 다른 claim도 그 행에서는 1이 된다', async () => {
    const db = createDb();
    const rows = installStreams(db);
    seedStream(rows, null, { streamType: 'ISSUE' });

    const written = await repositoryFor(db).upsertStreamFrontier({
      repositoryId: 'repo-1',
      streamType: 'ISSUE',
      frontierSha: 'from-null',
      expectedSyncEpoch: 9n,
    });

    expect(written.syncEpoch).toBe(1n);
    expect(rows.get('repo-1:ISSUE')?.syncEpoch).toBe(1n);
    expect(rows.get('repo-1:ISSUE')?.frontierSha).toBe('from-null');
  });

  it('먼저 들어간 null epoch 행은 빈 claim이 이어 받고 이미 1이면 거절한다', async () => {
    const db = createDb();
    const rows = installStreams(db);
    db.collectionRepositoryStream.create.mockImplementation(() => {
      if (!rows.has('repo-1:COMMIT')) {
        rows.set(
          'repo-1:COMMIT',
          seedStream(rows, null, { frontierSha: 'racer-sha' }),
        );
      }
      return Promise.reject(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
    });

    const written = await repositoryFor(db).upsertStreamFrontier({
      repositoryId: 'repo-1',
      streamType: 'COMMIT',
      frontierSha: 'loser-sha',
      lastRunAt: new Date('2026-11-12T04:00:00.000Z'),
      expectedSyncEpoch: null,
    });

    expect(written).toMatchObject({
      frontierSha: 'loser-sha',
      syncEpoch: 1n,
    });
    expect(rows.get('repo-1:COMMIT')?.lastRunAt).toEqual(
      new Date('2026-11-12T04:00:00.000Z'),
    );

    rows.set(
      'repo-1:COMMIT',
      seedStream(rows, 1n, { frontierSha: 'racer-sha', lastRunAt: null }),
    );
    await expect(
      repositoryFor(db).upsertStreamFrontier({
        repositoryId: 'repo-1',
        streamType: 'COMMIT',
        frontierSha: 'later-sha',
        expectedSyncEpoch: null,
      }),
    ).rejects.toBeInstanceOf(StaleSyncEpochError);
    expect(rows.get('repo-1:COMMIT')).toMatchObject({
      frontierSha: 'racer-sha',
      syncEpoch: 1n,
      lastRunAt: null,
    });
  });

  it('행이 없는데 claim이 있으면 아무것도 쓰지 않고 거절한다', async () => {
    const db = createDb();
    const rows = installStreams(db);

    await expect(
      repositoryFor(db).upsertStreamFrontier({
        repositoryId: 'repo-1',
        streamType: 'COMMIT',
        frontierSha: 'nope',
        expectedSyncEpoch: 2n,
      }),
    ).rejects.toBeInstanceOf(StaleSyncEpochError);
    expect(rows.size).toBe(0);
  });
});

describe('CollectionIncrementalRepository — 가입자만 적재한다', () => {
  it('ORG 저장소도 가입하지 않았거나 작성자를 모르는 기여는 행을 만들지 않는다', async () => {
    const db = createDb();
    const registeredGithubIds = new Set([1n]);

    await repositoryFor(db).recordCommitFacts(
      'repo-1',
      [
        {
          sha: 'by-member',
          committedAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 1n,
        },
        {
          sha: 'by-stranger',
          committedAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 999n,
        },
        {
          sha: 'by-unknown',
          committedAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: null,
        },
      ],
      registeredGithubIds,
    );

    expectLedgerInsert(db);
    const serialized = stringifyWithBigint(db.$queryRaw.mock.calls);
    expect(serialized).toContain('by-member');
    expect(serialized).not.toContain('by-stranger');
    expect(serialized).not.toContain('by-unknown');
  });

  it('external PR·release 원본도 가입자 작성분만 적재한다', async () => {
    const db = createDb();
    const registeredGithubIds = new Set([1n]);

    await repositoryFor(db).recordPullRequestFacts(
      'repo-1',
      [
        {
          githubPullRequestId: 10n,
          state: 'OPEN',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 1n,
        },
        {
          githubPullRequestId: 11n,
          state: 'OPEN',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 999n,
        },
      ],
      registeredGithubIds,
    );
    await repositoryFor(db).recordReleaseFacts(
      'repo-1',
      [
        {
          githubReleaseId: 20n,
          publishedAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 1n,
        },
        {
          githubReleaseId: 21n,
          publishedAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 999n,
        },
      ],
      registeredGithubIds,
    );

    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    const serialized = stringifyWithBigint(db.$queryRaw.mock.calls);
    expect(serialized).toContain('pull_request');
    expect(serialized).toContain('release');
  });

  it('미가입자만 있는 배치는 fact와 집계를 모두 건드리지 않는다', async () => {
    const db = createDb();
    const registeredGithubIds = new Set<bigint>();

    await repositoryFor(db).recordCommitFacts(
      'repo-1',
      [
        {
          sha: 'by-stranger',
          committedAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 999n,
        },
      ],
      registeredGithubIds,
    );

    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('일별 Contribution은 더 이상 지우고 다시 채우지 않는다', async () => {
    const db = createDb();

    await repositoryFor(db).recordCommitFacts(
      'repo-1',
      [
        {
          sha: 'gone',
          committedAt: new Date('2026-03-01T00:00:00.000Z'),
          authorGithubId: 1n,
        },
      ],
      new Set([1n]),
    );

    expectLedgerInsert(db);
  });
});
