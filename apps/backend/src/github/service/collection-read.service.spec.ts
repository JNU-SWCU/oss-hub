import { CronTime } from 'cron';
import { CollectionReadService } from './collection-read.service';
import { PublicRankingRepository } from '../repository/public-ranking.repository';
import type { CollectionCanonicalRepository } from '../repository/collection-canonical.repository';
import type { PrismaService } from '../../prisma/prisma.service';

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
  githubRepository: {
    findMany: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
  };
  contribution: { findMany: jest.Mock };
  repository: { findMany: jest.Mock };
  program: { findMany: jest.Mock };
  user: { findMany: jest.Mock };
  collectionRepositoryStream: {
    groupBy: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
  };
  collectionSyncCursor: { findFirst: jest.Mock };
  collectionSweepHistory: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    aggregate: jest.Mock;
  };
}

const createDb = (): MockPrisma => ({
  githubRepository: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _max: { lastSuccessAt: null } }),
  },
  contribution: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  // 프로비저닝 테이블 — 조직 밖 저장소의 "신청에 연결됨" 증명원이자
  // (저장소 → 프로그램) 배치 조인의 첫 단계. 기본은 "연결된 것 없음"이라
  // EXTERNAL_PUBLIC은 걸러지고 programName도 null로 접힌다.
  repository: { findMany: jest.fn().mockResolvedValue([]) },
  // (저장소 → 프로그램) 배치 조인의 두 번째 단계. 기본값은 빈 목록이며 각
  // 테스트가 필요한 만큼 채운다.
  program: { findMany: jest.fn().mockResolvedValue([]) },
  // 표시명 원본. 기본값은 빈 목록이며 각 테스트가 필요한 만큼 채운다.
  user: {
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
  collectionSweepHistory: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    aggregate: jest.fn().mockResolvedValue({
      _sum: {
        insertedCommitCount: null,
        insertedPullRequestCount: null,
        insertedReleaseCount: null,
      },
    }),
  },
});

/** `githubRepository.findMany` 의 첫 호출 where 를 구조로 본다. */
function argsOfGithubRepository(db: MockPrisma): {
  OR?: readonly Record<string, unknown>[];
} {
  const call = db.githubRepository.findMany.mock.calls[0] as
    [{ where: { OR?: readonly Record<string, unknown>[] } }] | undefined;
  if (call === undefined) throw new Error('호출되지 않았다');
  return call[0].where;
}

const serviceFor = (db: MockPrisma): CollectionReadService =>
  new CollectionReadService(
    db as unknown as PrismaService,
    {} as CollectionCanonicalRepository,
    new PublicRankingRepository(db as unknown as PrismaService),
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
      where: {
        githubRepositoryId: { in: readonly bigint[] };
        source?: string;
        OR?: readonly {
          source?: string;
          githubRepositoryId?: { in: readonly bigint[] };
        }[];
      };
    }) => {
      const { in: ids } = args.where.githubRepositoryId;
      const { source, OR } = args.where;
      // 서비스는 이제 `OR` 로 "조직 저장소이거나, 신청에 연결된 조직 밖 저장소"를
      // 표현한다. 실제 Prisma 처럼 절 하나라도 맞으면 통과시킨다 —
      // 여기서 흉내내지 않으면 GR-13 가드가 코드에서 사라져도 테스트가 통과한다.
      const matchesOr = (row: Row): boolean =>
        OR === undefined ||
        OR.some((clause) => {
          const rowSource = REPOSITORY_SOURCE_BY_ID.get(row.githubRepositoryId);
          if (clause.source !== undefined && clause.source !== rowSource) {
            return false;
          }
          if (
            clause.githubRepositoryId !== undefined &&
            !clause.githubRepositoryId.in.includes(row.githubRepositoryId)
          ) {
            return false;
          }
          return true;
        });
      return Promise.resolve(
        rows.filter(
          (row) =>
            ids.includes(row.githubRepositoryId) &&
            (source === undefined ||
              REPOSITORY_SOURCE_BY_ID.get(row.githubRepositoryId) === source) &&
            matchesOr(row),
        ),
      );
    },
  );
}

/**
 * `contribution.findMany` 호출을
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
          OR?: readonly {
            source?: string;
            githubRepositoryId?: { in: readonly bigint[] };
          }[];
        };
      };
    }) => {
      const { in: ids } = args.where.repository.githubRepositoryId;
      const { source, OR } = args.where.repository;
      // 위 저장소 필터와 같은 이유로 `OR` 를 흉내낸다.
      const matchesOr = (id: bigint): boolean =>
        OR === undefined ||
        OR.some((clause) => {
          const rowSource = REPOSITORY_SOURCE_BY_ID.get(id);
          if (clause.source !== undefined && clause.source !== rowSource) {
            return false;
          }
          if (
            clause.githubRepositoryId !== undefined &&
            !clause.githubRepositoryId.in.includes(id)
          ) {
            return false;
          }
          return true;
        });
      return Promise.resolve(
        rows.filter(
          (row) =>
            ids.includes(row.repository.githubRepositoryId) &&
            (source === undefined ||
              REPOSITORY_SOURCE_BY_ID.get(row.repository.githubRepositoryId) ===
                source) &&
            matchesOr(row.repository.githubRepositoryId),
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
          // 조직 저장소이거나, 신청에 연결된 조직 밖 저장소만 통과한다.
          OR: [
            { source: 'ORG_PROVISIONED' },
            { source: 'EXTERNAL_PUBLIC', githubRepositoryId: { in: [] } },
          ],
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
        contributions: [
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
          // 조직 저장소이거나, 신청에 연결된 조직 밖 저장소만 통과한다.
          OR: [
            { source: 'ORG_PROVISIONED' },
            { source: 'EXTERNAL_PUBLIC', githubRepositoryId: { in: [] } },
          ],
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
        contributions: [],
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
        contributions: [],
      },
      {
        githubRepositoryId: EXTERNAL_REPOSITORY_ID,
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        lastCompleteInventoryObservedAt: asOf,
        contributions: [],
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
          // 연 경계를 date 범위로 건다(ADR-010 §4 — 저장에 연도 칸이 없다).
          date: {
            gte: new Date(Date.UTC(2026, 0, 1) - 9 * 60 * 60 * 1000),
            lt: new Date(Date.UTC(2027, 0, 1) - 9 * 60 * 60 * 1000),
          },
          repository: {
            githubRepositoryId: { in: [101n] },
            OR: [
              { source: 'ORG_PROVISIONED' },
              { source: 'EXTERNAL_PUBLIC', githubRepositoryId: { in: [] } },
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

describe('CollectionReadService — getPublicRankingMetrics', () => {
  it('filters to org 저장소(visibility 무관) + PUBLIC 인 등록된 external 저장소 + PRESENT at the query boundary', async () => {
    const db = createDb();
    db.user.findMany.mockResolvedValue([
      { githubId: 1n, nickname: 'alice' },
      { githubId: 2n, nickname: 'bob' },
    ]);
    db.contribution.findMany.mockResolvedValue([]);

    await serviceFor(db).getPublicRankingMetrics({});

    expect(db.contribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repository: {
            presence: 'PRESENT',
            OR: [
              { source: 'ORG_PROVISIONED' },
              { source: 'EXTERNAL_PUBLIC', visibility: 'PUBLIC' },
            ],
          },
        },
      }),
    );
  });

  it('adds a year filter only when currentYear is provided (THIS_YEAR vs ALL)', async () => {
    const db = createDb();
    db.user.findMany.mockResolvedValue([
      { githubId: 1n, nickname: 'alice' },
      { githubId: 2n, nickname: 'bob' },
    ]);
    db.contribution.findMany.mockResolvedValue([]);

    await serviceFor(db).getPublicRankingMetrics({ currentYear: 2026 });

    expect(db.contribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repository: {
            presence: 'PRESENT',
            OR: [
              { source: 'ORG_PROVISIONED' },
              { source: 'EXTERNAL_PUBLIC', visibility: 'PUBLIC' },
            ],
          },
          // 저장에 연도 칸이 없으므로 Asia/Seoul 연 경계로 자른다(ADR-010 §4).
          date: {
            gte: new Date(Date.UTC(2026, 0, 1) - 9 * 60 * 60 * 1000),
            lt: new Date(Date.UTC(2027, 0, 1) - 9 * 60 * 60 * 1000),
          },
        },
      }),
    );
  });

  it('merges repository/year rows into one entry per githubUserId, 기여 없는 User 는 0/0/0으로 포함한다', async () => {
    const db = createDb();
    db.user.findMany.mockResolvedValue([
      { githubId: 1n, nickname: 'alice' },
      { githubId: 2n, nickname: 'bob' },
    ]);
    db.contribution.findMany.mockResolvedValue([
      {
        githubId: 1n,
        commitCount: 2,
        pullRequestCount: 1,
        releaseCount: 0,
      },
      {
        githubId: 1n,
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
        pullRequestCount: 1,
        releaseCount: 1,
      },
      // PM 확정 정책 — 가입한 모든 사용자가 노출된다. bob 은 기여 행이 없어도
      // 0/0/0으로 포함된다.
      {
        githubId: 2n,
        githubLogin: 'bob',
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      },
    ]);
  });

  // 옛 집계는 `githubLogin` 을 비정규화해 들고 있어서 같은 사람의 login 이 행마다
  // 갈릴 수 있었고, 그래서 정규화 소문자 기준 tie-break 가 필요했다.
  // 이제 표시명 원본이 `User` 하나이므로(ADR-010 §4) 갈릴 수가 없다 —
  // 검증할 것은 tie-break 가 아니라 "여러 행이 한 사람으로 접히는가"다.
  it('같은 사람의 여러 행이 하나로 접히고 표시명은 User 에서 온다', async () => {
    const db = createDb();
    db.user.findMany.mockResolvedValue([
      { githubId: 1n, nickname: 'alice' },
      { githubId: 2n, nickname: 'bob' },
    ]);
    db.contribution.findMany.mockResolvedValue([
      {
        githubId: 1n,
        commitCount: 1,
        pullRequestCount: 0,
        releaseCount: 0,
      },
      {
        githubId: 1n,
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
        pullRequestCount: 0,
        releaseCount: 0,
      },
      {
        githubId: 2n,
        githubLogin: 'bob',
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      },
    ]);
  });

  it('does not select repositoryId, year, dataAsOf, or any private/platform field', async () => {
    const db = createDb();
    db.user.findMany.mockResolvedValue([
      { githubId: 1n, nickname: 'alice' },
      { githubId: 2n, nickname: 'bob' },
    ]);
    db.contribution.findMany.mockResolvedValue([]);

    await serviceFor(db).getPublicRankingMetrics({});

    expect(db.contribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          githubId: true,
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
    db.user.findMany.mockResolvedValue([
      { githubId: 1n, nickname: 'alice' },
      { githubId: 2n, nickname: 'bob' },
    ]);
    db.contribution.findMany.mockResolvedValue([
      // Asia/Seoul 자정을 UTC 로 담은 날짜 — 코드가 여기서 연도를 뽑는다.
      { date: new Date(Date.UTC(2026, 4, 1)) },
      { date: new Date(Date.UTC(2025, 10, 20)) },
    ]);

    await expect(serviceFor(db).listPublicRankingYears()).resolves.toEqual([
      2026, 2025,
    ]);

    expect(db.contribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repository: {
            presence: 'PRESENT',
            OR: [
              { source: 'ORG_PROVISIONED' },
              { source: 'EXTERNAL_PUBLIC', visibility: 'PUBLIC' },
            ],
          },
          OR: [
            { commitCount: { gt: 0 } },
            { pullRequestCount: { gt: 0 } },
            { releaseCount: { gt: 0 } },
          ],
        },
        select: { date: true },
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
        contributions: [
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
          visibility: 'PUBLIC',
          presence: 'PRESENT',
          // 조직 저장소이거나, 신청에 연결된 조직 밖 저장소만 통과한다.
          OR: [
            { source: 'ORG_PROVISIONED' },
            { source: 'EXTERNAL_PUBLIC', githubRepositoryId: { in: [] } },
          ],
        },
      }),
    );
    const calls = db.githubRepository.findMany.mock.calls as unknown[][];
    const call = calls[0]?.[0] as {
      select: { contributions: { where?: unknown } };
    };
    expect(call.select.contributions.where).toBeUndefined();
  });

  it('returns a zero-value row and falls back to the last inventory observation for dataAsOf when there is no aggregate yet', async () => {
    const db = createDb();
    const observedAt = new Date('2025-12-15T00:00:00.000Z');
    db.githubRepository.findMany.mockResolvedValue([
      {
        githubRepositoryId: 202n,
        lastCompleteInventoryObservedAt: observedAt,
        contributions: [],
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
        contributions: [],
      },
      {
        githubRepositoryId: EXTERNAL_REPOSITORY_ID,
        lastCompleteInventoryObservedAt: asOf,
        contributions: [],
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
    expect(db.contribution.findMany).not.toHaveBeenCalled();
  });

  it('sums a contributor across years without a year filter and keeps distinct contributors separate', async () => {
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
        updatedAt: new Date('2025-12-31T00:00:00.000Z'),
        repository: { githubRepositoryId: 101n },
      },
      {
        githubId: 1n,
        commitCount: 2,
        pullRequestCount: 0,
        releaseCount: 1,
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
        repository: { githubRepositoryId: 101n },
      },
      {
        githubId: 2n,
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
    expect(db.contribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repository: {
            githubRepositoryId: { in: [101n] },
            visibility: 'PUBLIC',
            presence: 'PRESENT',
            OR: [
              { source: 'ORG_PROVISIONED' },
              { source: 'EXTERNAL_PUBLIC', githubRepositoryId: { in: [] } },
            ],
          },
        },
      }),
    );
  });

  it('returns an empty array when no contributor fact exists for the repositories', async () => {
    const db = createDb();
    db.user.findMany.mockResolvedValue([
      { githubId: 1n, nickname: 'alice' },
      { githubId: 2n, nickname: 'bob' },
    ]);
    db.contribution.findMany.mockResolvedValue([]);

    const result = await serviceFor(db).getContributorCumulativeMetrics({
      repositoryIds: [101n],
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
      dueRepositoryCount: 0,
      failingRepositoryCount: 0,
      lastRepositorySuccessAt: null,
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
      dueRepositoryCount: 2,
      failingRepositoryCount: 2,
      lastRepositorySuccessAt: null,
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

/**
 * 2026-08 owner 결정 — `getIncrementalStatusStreams`. `getIncrementalStatusSnapshot`과 같은
 * `PRESENT_REPOSITORY` 조건·bucket 우선순위(재시도 대기 > backfilling/ready > partial)를
 * stream 단위로 반복한다는 계약을 검증한다. 집계 parity 테스트는 aggregate 쪽 groupBy/count
 * mock이 아니라 이 메서드가 읽는 `githubRepository.findMany`의 `streams` 관계만으로 같은
 * bucket 카운트가 나오는지 손으로 합산해 확인한다 — 두 메서드가 서로 다른 질의 경로를 쓰므로
 * "같은 fixture → 같은 합"이 실제로 코드 경로 두 개를 모두 통과했다는 뜻이 된다.
 */
describe('CollectionReadService — getIncrementalStatusStreams', () => {
  it('추적 저장소가 없으면 빈 배열을 반환한다', async () => {
    const db = createDb();

    const result = await serviceFor(db).getIncrementalStatusStreams();

    expect(result).toEqual([]);
    expect(db.githubRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { presence: 'PRESENT', source: 'ORG_PROVISIONED' },
        orderBy: { nameWithOwner: 'asc' },
      }),
    );
  });

  it('아직 생성되지 않은 stream row는 PARTIAL로 채워 COMMIT/PULL_REQUEST/RELEASE 순서를 보장한다', async () => {
    const db = createDb();
    db.githubRepository.findMany.mockResolvedValue([
      {
        githubRepositoryId: 301n,
        nameWithOwner: 'JNU-SWCU/alpha',
        streams: [
          {
            streamType: 'COMMIT',
            status: 'READY',
            lastRunAt: new Date('2026-07-25T10:00:00.000Z'),
            lastErrorCode: null,
            lastErrorAt: null,
          },
          // PULL_REQUEST/RELEASE row가 아직 없다 — 저장소가 막 등록된 경우.
        ],
      },
    ]);

    const result = await serviceFor(db).getIncrementalStatusStreams();

    expect(result).toEqual([
      {
        repositoryName: 'JNU-SWCU/alpha',
        // Repository↔Program 연결이 없으므로(기본 mock) null — 정상 상태다.
        programName: null,
        streams: [
          {
            streamType: 'COMMIT',
            bucket: 'READY',
            lastSuccessAt: new Date('2026-07-25T10:00:00.000Z'),
            lastErrorCode: null,
            lastErrorAt: null,
          },
          {
            streamType: 'PULL_REQUEST',
            bucket: 'PARTIAL',
            lastSuccessAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          },
          {
            streamType: 'RELEASE',
            bucket: 'PARTIAL',
            lastSuccessAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          },
        ],
      },
    ]);
  });

  /**
   * 저장소↔프로그램 연결 노출 — `GithubRepository.githubRepositoryId`로
   * `Repository.programId`를 거쳐 `Program.name`을 채운다(위 port 코멘트 참고).
   * 연결이 있는 저장소와 없는 저장소를 같은 배치에 섞어, 있는 쪽만 채워지고
   * 없는 쪽은 null로 남는지 함께 확인한다.
   */
  it('githubRepositoryId → Repository.programId → Program.name 경유로 programName을 채운다', async () => {
    const db = createDb();
    db.githubRepository.findMany.mockResolvedValue([
      {
        githubRepositoryId: 301n,
        nameWithOwner: 'JNU-SWCU/alpha',
        streams: [],
      },
      { githubRepositoryId: 302n, nameWithOwner: 'JNU-SWCU/beta', streams: [] },
    ]);
    db.repository.findMany.mockResolvedValue([
      { githubRepositoryId: 301n, programId: 'program-1' },
    ]);
    db.program.findMany.mockResolvedValue([
      { id: 'program-1', name: '오픈소스 입문 프로그램' },
    ]);

    const result = await serviceFor(db).getIncrementalStatusStreams();

    expect(
      result.map((repo) => [repo.repositoryName, repo.programName]),
    ).toEqual([
      ['JNU-SWCU/alpha', '오픈소스 입문 프로그램'],
      ['JNU-SWCU/beta', null],
    ]);
    // 저장소 개수와 무관하게 배치 조회 1번씩 — N+1이 아니다.
    expect(db.repository.findMany).toHaveBeenCalledTimes(1);
    expect(db.program.findMany).toHaveBeenCalledTimes(1);
    expect(db.repository.findMany).toHaveBeenCalledWith({
      where: { githubRepositoryId: { in: [301n, 302n] } },
      select: { githubRepositoryId: true, programId: true },
    });
  });

  it('lastErrorCode가 있으면 status가 READY여도 RETRY_PENDING이 우선한다(집계 쪽과 같은 우선순위)', async () => {
    const db = createDb();
    db.githubRepository.findMany.mockResolvedValue([
      {
        nameWithOwner: 'JNU-SWCU/alpha',
        streams: [
          {
            streamType: 'COMMIT',
            status: 'READY',
            lastRunAt: new Date('2026-07-25T10:00:00.000Z'),
            lastErrorCode: 'COL_RATE_LIMITED',
            lastErrorAt: new Date('2026-07-25T09:00:00.000Z'),
          },
        ],
      },
    ]);

    const result = await serviceFor(db).getIncrementalStatusStreams();

    expect(result[0]?.streams[0]).toEqual({
      streamType: 'COMMIT',
      bucket: 'RETRY_PENDING',
      lastSuccessAt: new Date('2026-07-25T10:00:00.000Z'),
      lastErrorCode: 'COL_RATE_LIMITED',
      lastErrorAt: new Date('2026-07-25T09:00:00.000Z'),
    });
  });

  it('BACKFILLING 상태 stream은 BACKFILLING bucket으로 통과시킨다', async () => {
    const db = createDb();
    db.githubRepository.findMany.mockResolvedValue([
      {
        nameWithOwner: 'JNU-SWCU/alpha',
        streams: [
          {
            streamType: 'COMMIT',
            status: 'BACKFILLING',
            lastRunAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          },
        ],
      },
    ]);

    const result = await serviceFor(db).getIncrementalStatusStreams();

    expect(result[0]?.streams[0]?.bucket).toBe('BACKFILLING');
  });

  it('bucket 합계가 getIncrementalStatusSnapshot의 집계 카운트와 정확히 일치한다(동일 fixture, 에러 없음)', async () => {
    // 집계 쪽 partialStreamCount(status 기반)와 retryPendingStreamCount(lastErrorCode
    // 기반)는 서로 배타적이지 않다 — 한 stream이 PENDING이면서 동시에 lastErrorCode를
    // 가질 수 있어(위 RETRY_PENDING-우선순위 테스트 참고) 그 경우 집계는 그 stream을
    // partial과 retryPending 양쪽에 동시에 센다. 반면 per-stream bucket 분류는 stream당
    // bucket을 정확히 하나만 고른다(RETRY_PENDING이 최우선). 그래서 "bucket 합 == 집계
    // count" parity는 lastErrorCode가 전혀 없는(RETRY_PENDING이 0인) fixture에서만
    // 깨끗하게 성립한다 — 이 테스트가 그 경우를 고정한다. 겹치는 경우의 우선순위
    // 자체는 위 "RETRY_PENDING이 우선한다" 테스트가 별도로 고정한다.
    //
    // 2개 저장소 × 3 stream = 6개. ready 4, backfilling 1, partial(PENDING, 에러 없음) 1.
    const streamsFixture = {
      groupBy: [
        { status: 'READY', _count: { _all: 4 } },
        { status: 'BACKFILLING', _count: { _all: 1 } },
        { status: 'PENDING', _count: { _all: 1 } },
      ],
      retryPendingCount: 0,
    };

    const snapshotDb = createDb();
    snapshotDb.githubRepository.count.mockResolvedValue(2);
    snapshotDb.collectionRepositoryStream.groupBy.mockResolvedValue(
      streamsFixture.groupBy,
    );
    snapshotDb.collectionRepositoryStream.count.mockResolvedValue(
      streamsFixture.retryPendingCount,
    );
    const snapshot =
      await serviceFor(snapshotDb).getIncrementalStatusSnapshot();

    // 같은 분포를 만드는 저장소별 stream 상세 — 2개 저장소, 총 6 stream:
    // READY 4, BACKFILLING 1, PENDING(에러 없음) 1. 어떤 stream도 lastErrorCode가
    // 없으므로 RETRY_PENDING으로 재분류될 stream이 없다.
    const streamsDb = createDb();
    streamsDb.githubRepository.findMany.mockResolvedValue([
      {
        nameWithOwner: 'JNU-SWCU/alpha',
        streams: [
          {
            streamType: 'COMMIT',
            status: 'READY',
            lastRunAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          },
          {
            streamType: 'PULL_REQUEST',
            status: 'READY',
            lastRunAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          },
          {
            streamType: 'RELEASE',
            status: 'BACKFILLING',
            lastRunAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          },
        ],
      },
      {
        nameWithOwner: 'JNU-SWCU/beta',
        streams: [
          {
            streamType: 'COMMIT',
            status: 'READY',
            lastRunAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          },
          {
            streamType: 'PULL_REQUEST',
            status: 'READY',
            lastRunAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          },
          {
            streamType: 'RELEASE',
            status: 'PENDING',
            lastRunAt: null,
            lastErrorCode: null,
            lastErrorAt: null,
          },
        ],
      },
    ]);
    const detail = await serviceFor(streamsDb).getIncrementalStatusStreams();

    const allStreams = detail.flatMap((repository) => repository.streams);
    const countOf = (bucket: string): number =>
      allStreams.filter((stream) => stream.bucket === bucket).length;

    expect(countOf('READY')).toBe(snapshot.readyStreamCount);
    expect(countOf('BACKFILLING')).toBe(snapshot.backfillingStreamCount);
    expect(countOf('RETRY_PENDING')).toBe(snapshot.retryPendingStreamCount);
    expect(countOf('PARTIAL')).toBe(snapshot.partialStreamCount);
    expect(allStreams).toHaveLength(6);
  });
});

/**
 * 큐 건강 지표 (ADR-010 §6·§10).
 *
 * 이번 사고는 "멈췄는데 아무도 몰랐다"였다. 스트림 상태만 보면 저장소 하나가
 * 계속 실패하며 큐를 붙잡고 있어도 전체는 정상으로 보인다.
 */
describe('CollectionReadService — 큐가 막히면 지표가 말한다', () => {
  it('차례 지난 저장소와 연속 실패 저장소를 센다', async () => {
    const db = createDb();
    db.githubRepository.count.mockImplementation(
      ({
        where,
      }: {
        where: { nextRunAt?: unknown; failureCount?: unknown };
      }) => {
        if (where.nextRunAt !== undefined) return Promise.resolve(7);
        if (where.failureCount !== undefined) return Promise.resolve(3);
        return Promise.resolve(10);
      },
    );
    db.githubRepository.aggregate.mockResolvedValue({
      _max: { lastSuccessAt: new Date('2026-08-09T00:00:00.000Z') },
    });

    const snapshot = await serviceFor(db).getIncrementalStatusSnapshot();

    expect(snapshot.dueRepositoryCount).toBe(7);
    expect(snapshot.failingRepositoryCount).toBe(3);
    expect(snapshot.lastRepositorySuccessAt).toEqual(
      new Date('2026-08-09T00:00:00.000Z'),
    );
  });

  it('저장소 이름이나 학생 식별자를 담지 않는다', async () => {
    const db = createDb();

    const snapshot = await serviceFor(db).getIncrementalStatusSnapshot();

    // admin 전용 화면이라도 조직 내부 정보다(AGENTS.md §6).
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('nameWithOwner');
    expect(serialized).not.toContain('githubLogin');
    expect(serialized).not.toContain('githubId');
  });
});

/**
 * 프로그램 표면의 조직 밖 저장소 포함 조건 (ADR-009 §3 · ADR-010 §5).
 *
 * 예전에는 `source: 'ORG_PROVISIONED'`로 통째 막았다. 그러면 학생의 무관한 개인
 * 저장소가 조직 실적으로 새는 것은 막히지만, `OWN`으로 **연결한** 저장소까지
 * 함께 막혀 원래 목적("내 팀 저장소 기여를 본다")이 성립하지 않았다.
 *
 * 이제 판정을 호출자가 아니라 DB가 한다 — 프로비저닝 테이블에 같은
 * `githubRepositoryId` 행이 있어야 조직 밖 저장소가 통과한다.
 */
describe('CollectionReadService — 조직 밖 저장소는 연결이 증명될 때만 포함한다', () => {
  it('신청에 연결된 EXTERNAL_PUBLIC 저장소는 통과한다', async () => {
    const db = createDb();
    // 프로비저닝 테이블이 연결을 증명한다.
    db.repository.findMany.mockResolvedValue([{ githubRepositoryId: 202n }]);

    await serviceFor(db).findRepositoryActivity({ repositoryIds: [202n] });

    const where = argsOfGithubRepository(db);
    expect(where.OR).toEqual([
      { source: 'ORG_PROVISIONED' },
      { source: 'EXTERNAL_PUBLIC', githubRepositoryId: { in: [202n] } },
    ]);
  });

  it('연결되지 않은 EXTERNAL_PUBLIC 저장소는 통과하지 못한다', async () => {
    const db = createDb();
    // 연결 증명이 없다 — 학생의 무관한 개인 저장소가 이 경우다.
    db.repository.findMany.mockResolvedValue([]);

    await serviceFor(db).findRepositoryActivity({ repositoryIds: [999n] });

    const where = argsOfGithubRepository(db);
    // 빈 목록이므로 EXTERNAL_PUBLIC 절이 아무것도 매치하지 않는다.
    expect(where.OR).toEqual([
      { source: 'ORG_PROVISIONED' },
      { source: 'EXTERNAL_PUBLIC', githubRepositoryId: { in: [] } },
    ]);
  });

  it('연결 판정은 호출자가 넘긴 id 범위 안에서만 조회한다', async () => {
    const db = createDb();
    db.repository.findMany.mockResolvedValue([]);

    await serviceFor(db).findRepositoryActivity({ repositoryIds: [1n, 2n] });

    // 전체 스캔이 아니라 요청된 id 로만 묻는다.
    const call = db.repository.findMany.mock.calls[0] as
      [{ where: { githubRepositoryId: { in: bigint[] } } }] | undefined;
    expect(call?.[0].where.githubRepositoryId.in).toEqual([1n, 2n]);
  });
});

/**
 * ADR-003 DEC-42 — `system-status.service.spec.ts`에 있던 cron 계산 테스트를 그대로
 * 옮겼다(구현이 이 서비스로 이관됐으므로). `COLLECTION_CRON_EXPRESSION`은 process.env를
 * 거쳐 모듈 로드 시 고정되므로 여기서 값을 바꿔가며 주입할 수는 없다 — 대신 실제 배선된
 * 표현식(기본값 `'0 0 * * * *'`, 매시 정각)을 기준으로 `getNextDateFrom`이 손으로 계산
 * 가능한 다음 발생 시각을 내는지, 그리고 `from`이 그대로 전달되는지를 검증한다.
 */
describe('CollectionReadService — getNextScheduledCycleAt', () => {
  it('배선된 cron 표현식을 from 이후 Asia/Seoul 기준으로 평가해 다음 발생 시각을 반환한다', async () => {
    // from = UTC 2026-07-25T12:34:56 = KST 21:34:56. 기본 표현식(매시 정각)의 다음
    // 발생은 KST 22:00:00 = UTC 13:00:00.
    const from = new Date('2026-07-25T12:34:56.000Z');

    const result = await serviceFor(createDb()).getNextScheduledCycleAt(from);

    expect(result).toEqual(new Date('2026-07-25T13:00:00.000Z'));
  });

  it('정확히 정시(경계)에도 다음 시간 정각을 반환한다', async () => {
    const from = new Date('2026-07-25T12:00:00.000Z');

    const result = await serviceFor(createDb()).getNextScheduledCycleAt(from);

    expect(result).toEqual(new Date('2026-07-25T13:00:00.000Z'));
  });

  it('계산이 실패하면(운영 실수로 배선된 표현식이 깨진 경우) null을 반환하고 던지지 않는다', async () => {
    // 배선된 표현식 자체는 process.env로 모듈 로드 시 고정돼 여기서 바꿀 수 없으므로,
    // try/catch → null 폴백 자체를 CronTime 계산 실패로 재현한다.
    const spy = jest
      .spyOn(CronTime.prototype, 'getNextDateFrom')
      .mockImplementation(() => {
        throw new Error('boom');
      });

    const result = await serviceFor(createDb()).getNextScheduledCycleAt(
      new Date('2026-07-25T12:00:00.000Z'),
    );

    expect(result).toBeNull();
    spy.mockRestore();
  });
});

describe('CollectionReadService — getRecentSweepActivity', () => {
  it('최근 순으로 sweepFinishedAt desc 정렬해 limit 만큼 조회하고 행을 DTO로 옮긴다', async () => {
    const db = createDb();
    db.collectionSweepHistory.findMany.mockResolvedValue([
      {
        sweepFinishedAt: new Date('2026-08-01T12:00:00.000Z'),
        cycleStartedAt: new Date('2026-08-01T11:00:00.000Z'),
        scope: 'org:jnu-swcu',
        insertedCommitCount: 3,
        insertedPullRequestCount: 1,
        insertedReleaseCount: 0,
        attemptedRepositoryCount: 2,
        processedRepositoryCount: 2,
        failedRepositoryCount: 0,
        cycleCompleted: true,
        stoppedForBudget: false,
      },
      {
        sweepFinishedAt: new Date('2026-08-01T10:00:00.000Z'),
        cycleStartedAt: null,
        scope: 'external',
        insertedCommitCount: 0,
        insertedPullRequestCount: 0,
        insertedReleaseCount: 0,
        attemptedRepositoryCount: 1,
        processedRepositoryCount: 0,
        failedRepositoryCount: 1,
        cycleCompleted: false,
        stoppedForBudget: true,
      },
    ]);

    const result = await serviceFor(db).getRecentSweepActivity(20);

    expect(db.collectionSweepHistory.findMany).toHaveBeenCalledWith({
      orderBy: { sweepFinishedAt: 'desc' },
      take: 20,
    });
    expect(result).toEqual([
      {
        sweepFinishedAt: new Date('2026-08-01T12:00:00.000Z'),
        cycleStartedAt: new Date('2026-08-01T11:00:00.000Z'),
        scope: 'org:jnu-swcu',
        insertedCommitCount: 3,
        insertedPullRequestCount: 1,
        insertedReleaseCount: 0,
        attemptedRepositoryCount: 2,
        processedRepositoryCount: 2,
        failedRepositoryCount: 0,
        cycleCompleted: true,
        stoppedForBudget: false,
      },
      {
        sweepFinishedAt: new Date('2026-08-01T10:00:00.000Z'),
        cycleStartedAt: null,
        scope: 'external',
        insertedCommitCount: 0,
        insertedPullRequestCount: 0,
        insertedReleaseCount: 0,
        attemptedRepositoryCount: 1,
        processedRepositoryCount: 0,
        failedRepositoryCount: 1,
        cycleCompleted: false,
        stoppedForBudget: true,
      },
    ]);
  });
});

/**
 * 시스템 상태 3단계 — `getExternalCollectionStatus`. `getIncrementalStatusSnapshot`이
 * 쓰는 `PRESENT_REPOSITORY`(`source: 'ORG_PROVISIONED'`)와 절대 섞이지 않는 별도
 * 상수(`source: 'EXTERNAL_PUBLIC'`)로 대상을 센다는 계약과, 누적 활동량이
 * `CollectionSweepHistory`의 scope `"external"` 합산이라는 계약을 검증한다.
 */
describe('CollectionReadService — getExternalCollectionStatus', () => {
  it('external 저장소가 없으면 트래킹 카운트 0·lastSweep null·누적 0을 반환한다', async () => {
    const db = createDb();

    const result = await serviceFor(db).getExternalCollectionStatus();

    expect(result).toEqual({
      trackedRepositoryCount: 0,
      lastSweep: null,
      cumulativeCommitCount: 0,
      cumulativePullRequestCount: 0,
      cumulativeReleaseCount: 0,
    });
    expect(db.githubRepository.count).toHaveBeenCalledWith({
      where: { presence: 'PRESENT', source: 'EXTERNAL_PUBLIC' },
    });
    expect(db.collectionSweepHistory.findFirst).toHaveBeenCalledWith({
      where: { scope: 'external' },
      orderBy: { sweepFinishedAt: 'desc' },
    });
    expect(db.collectionSweepHistory.aggregate).toHaveBeenCalledWith({
      where: { scope: 'external' },
      _sum: {
        insertedCommitCount: true,
        insertedPullRequestCount: true,
        insertedReleaseCount: true,
      },
    });
  });

  it('가장 최근 external sweep 행과 scope 합산 누적치를 반환한다', async () => {
    const db = createDb();
    db.githubRepository.count.mockResolvedValue(4);
    const lastSweep = {
      sweepFinishedAt: new Date('2026-08-01T10:00:00.000Z'),
      cycleStartedAt: new Date('2026-08-01T09:55:00.000Z'),
      scope: 'external',
      insertedCommitCount: 0,
      insertedPullRequestCount: 0,
      insertedReleaseCount: 0,
      attemptedRepositoryCount: 0,
      processedRepositoryCount: 0,
      failedRepositoryCount: 0,
      cycleCompleted: true,
      stoppedForBudget: false,
    };
    db.collectionSweepHistory.findFirst.mockResolvedValue(lastSweep);
    db.collectionSweepHistory.aggregate.mockResolvedValue({
      _sum: {
        insertedCommitCount: 12,
        insertedPullRequestCount: 3,
        insertedReleaseCount: 1,
      },
    });

    const result = await serviceFor(db).getExternalCollectionStatus();

    expect(result).toEqual({
      trackedRepositoryCount: 4,
      lastSweep,
      cumulativeCommitCount: 12,
      cumulativePullRequestCount: 3,
      cumulativeReleaseCount: 1,
    });
  });

  it('org 저장소와 external 저장소가 같은 fixture에 섞여 있어도 서로 다른 source where로 세어 org 집계를 오염시키지 않는다', async () => {
    const db = createDb();
    db.githubRepository.count.mockImplementation(
      ({ where }: { where: { source: string } }) => {
        if (where.source === 'ORG_PROVISIONED') return Promise.resolve(5);
        if (where.source === 'EXTERNAL_PUBLIC') return Promise.resolve(2);
        throw new Error(`unexpected source ${where.source}`);
      },
    );
    const service = serviceFor(db);

    const orgSnapshot = await service.getIncrementalStatusSnapshot();
    const externalStatus = await service.getExternalCollectionStatus();

    expect(orgSnapshot.trackedRepositoryCount).toBe(5);
    expect(externalStatus.trackedRepositoryCount).toBe(2);
  });
});
