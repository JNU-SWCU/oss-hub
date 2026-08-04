import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionCanonicalRepository } from './collection-canonical.repository';
import { asiaSeoulYear } from './collection-incremental.repository';
import type {
  CollectionContributorCumulativeMetricsDto,
  CollectionContributorCumulativeMetricsQueryDto,
  CollectionContributorMetricsDto,
  CollectionContributorMetricsQueryDto,
  CollectionPublicRankingMetricsDto,
  CollectionPublicRankingMetricsQueryDto,
  CollectionIncrementalStatusSnapshotDto,
  CollectionRankingActivityDto,
  CollectionRankingActivityQueryDto,
  CollectionReadPort,
  CollectionRepositoryActivityDto,
  CollectionRepositoryActivityQueryDto,
  CollectionRepositoryCumulativeMetricsDto,
  CollectionRepositoryCumulativeMetricsQueryDto,
  CollectionRepositoryMetricsDto,
  CollectionRepositoryMetricsQueryDto,
  CollectionStatusSnapshotDto,
} from './collection-read.port';

const PRESENT_REPOSITORY = { presence: 'PRESENT' } as const;

@Injectable()
export class CollectionReadService implements CollectionReadPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly canonicalRepository: CollectionCanonicalRepository,
  ) {}

  /**
   * todo 14 원자 전환 — 증분 저장소(`CollectionRepository`/facts)를 직접 읽는다. 이 포트의 유일한
   * 활성 호출자(`program-activity.service.ts`)를 새 authority로 옮기는 것이 이 메서드의 목적이다.
   * 다른 두 legacy 메서드(`findRankingActivity`/`getStatusSnapshot`)는 실제 운영 호출자가 없어
   * ADR-006의 "old generation 테이블 rollback 참조" 용도로만 old Canonical 테이블을 그대로 읽는다.
   */
  async findRepositoryActivity(
    query: CollectionRepositoryActivityQueryDto,
  ): Promise<readonly CollectionRepositoryActivityDto[]> {
    if (query.repositoryIds.length === 0) return [];

    const authorWhere = query.authorGithubId
      ? { authorGithubId: query.authorGithubId }
      : undefined;

    const repositories = await this.prisma.collectionRepository.findMany({
      where: { githubRepositoryId: { in: [...query.repositoryIds] } },
      select: {
        githubRepositoryId: true,
        updatedAt: true,
        lastCompleteInventoryObservedAt: true,
        commits: {
          where: authorWhere,
          select: { committedAt: true },
        },
        pullRequests: {
          where: authorWhere,
          select: { createdAt: true },
        },
        releases: {
          where: authorWhere,
          select: { publishedAt: true },
        },
      },
    });

    return repositories.map((repository) => ({
      repositoryId: repository.githubRepositoryId,
      dataAsOf:
        repository.lastCompleteInventoryObservedAt ?? repository.updatedAt,
      commitDates: repository.commits.map((commit) => commit.committedAt),
      pullRequestDates: repository.pullRequests.map(
        (pullRequest) => pullRequest.createdAt,
      ),
      releaseDates: repository.releases.map((release) => release.publishedAt),
    }));
  }

  async findRankingActivity(
    query: CollectionRankingActivityQueryDto,
  ): Promise<readonly CollectionRankingActivityDto[]> {
    const projections =
      await this.prisma.canonicalContributorProjection.findMany({
        where: {
          generation: { activeFor: { some: {} } },
          ...(query.currentYear === undefined
            ? {}
            : { currentYear: query.currentYear }),
        },
        select: {
          githubUserId: true,
          githubLogin: true,
          commitCount: true,
          pullRequestCount: true,
          releaseCount: true,
          currentYearCommitCount: true,
          currentYearPullRequestCount: true,
          currentYearReleaseCount: true,
        },
      });

    const activity = new Map<string, CollectionRankingActivityDto>();
    for (const row of projections) {
      const key = row.githubUserId.toString();
      const current = activity.get(key);
      const githubLogin =
        !current ||
        row.githubLogin.normalize().toLocaleLowerCase('en-US') <
          current.githubLogin.normalize().toLocaleLowerCase('en-US')
          ? row.githubLogin
          : current.githubLogin;
      const commitCount =
        query.currentYear === undefined
          ? row.commitCount
          : row.currentYearCommitCount;
      const prCount =
        query.currentYear === undefined
          ? row.pullRequestCount
          : row.currentYearPullRequestCount;
      const releaseCount =
        query.currentYear === undefined
          ? row.releaseCount
          : row.currentYearReleaseCount;
      activity.set(key, {
        githubId: row.githubUserId,
        githubLogin,
        commitCount: (current?.commitCount ?? 0) + commitCount,
        prCount: (current?.prCount ?? 0) + prCount,
        releaseCount: (current?.releaseCount ?? 0) + releaseCount,
      });
    }
    return [...activity.values()];
  }

  async getStatusSnapshot(): Promise<CollectionStatusSnapshotDto | null> {
    const keys = await this.prisma.$queryRawUnsafe<
      Array<{ appId: bigint; organizationLogin: string }>
    >(
      `SELECT "appId", "organizationLogin" FROM "CanonicalOrganizationState" ORDER BY "updatedAt" DESC LIMIT 1`,
    );
    const key = keys[0];
    if (!key) return null;

    const canonical = await this.canonicalRepository.getStatusSnapshot(key);
    if (!canonical) return null;

    const timestamps = await this.prisma.$queryRawUnsafe<
      Array<{
        lastCompleteSuccessAt: Date | null;
        dataAsOf: Date | null;
      }>
    >(
      `SELECT
         MAX(r."finishedAt") FILTER (WHERE r."status" = 'SUCCEEDED') AS "lastCompleteSuccessAt",
         active."finishedAt" AS "dataAsOf"
       FROM "CanonicalOrganizationState" s
       LEFT JOIN "CanonicalCollectionRun" r
         ON r."appId" = s."appId" AND r."organizationLogin" = s."organizationLogin"
       LEFT JOIN "CanonicalCollectionRun" active ON active."id" = s."activeGenerationId"
       WHERE s."appId" = $1 AND s."organizationLogin" = $2
       GROUP BY active."finishedAt"`,
      key.appId,
      key.organizationLogin,
    );

    return {
      installationValid: canonical.installationValid,
      permissionsValid: canonical.permissionsValid,
      runStatus: canonical.runStatus,
      lastCompleteSuccessAt: timestamps[0]?.lastCompleteSuccessAt ?? null,
      dataAsOf: timestamps[0]?.dataAsOf ?? null,
    };
  }

  /**
   * todo 11 — 신규 증분 aggregate 소스(`CollectionRepositoryYearAggregate`)를 직접 읽는다.
   * `year`를 생략하면 Asia/Seoul 기준 현재 연도를 쓴다. 해당 연도 집계 행이 아직 없어도(1/1
   * rollover) 저장소 자체가 관측되어 있으면 0값 행을 반환한다 — 신규 fact write를 요구하지 않는다.
   * private/public 저장소를 가리지 않고 그대로 반환한다(private facts internally readable) —
   * eligibility 필터링은 이 포트를 호출하는 쪽(todo 15/19)의 책임이다.
   */
  async getRepositoryMetrics(
    query: CollectionRepositoryMetricsQueryDto,
  ): Promise<readonly CollectionRepositoryMetricsDto[]> {
    if (query.repositoryIds.length === 0) return [];
    const year = query.year ?? asiaSeoulYear(new Date());

    const repositories = await this.prisma.collectionRepository.findMany({
      where: { githubRepositoryId: { in: [...query.repositoryIds] } },
      select: {
        githubRepositoryId: true,
        visibility: true,
        presence: true,
        lastCompleteInventoryObservedAt: true,
        yearAggregates: {
          where: { year },
          select: {
            commitCount: true,
            pullRequestCount: true,
            releaseCount: true,
            updatedAt: true,
          },
        },
      },
    });

    return repositories.map((repository) => {
      const aggregate = repository.yearAggregates[0];
      return {
        repositoryId: repository.githubRepositoryId,
        year,
        dataAsOf:
          aggregate?.updatedAt ??
          repository.lastCompleteInventoryObservedAt ??
          new Date(),
        commitCount: aggregate?.commitCount ?? 0,
        pullRequestCount: aggregate?.pullRequestCount ?? 0,
        releaseCount: aggregate?.releaseCount ?? 0,
        visibility: repository.visibility,
        presence: repository.presence,
        visibilityObservedAt: repository.lastCompleteInventoryObservedAt,
      };
    });
  }

  /**
   * todo 11 — 신규 증분 aggregate 소스(`CollectionContributorYearAggregate`)를 직접 읽는다
   * (ranking source). repository 집계와 달리 0값 기본 행을 만들지 않는다 — 해당 연도에 실제
   * fact가 있는 (repository, contributor) 조합만 존재한다(기존 `getContributorYearAggregate`와
   * 동일한 규약).
   */
  async getContributorMetrics(
    query: CollectionContributorMetricsQueryDto,
  ): Promise<readonly CollectionContributorMetricsDto[]> {
    if (query.repositoryIds.length === 0) return [];
    const year = query.year ?? asiaSeoulYear(new Date());

    const rows = await this.prisma.collectionContributorYearAggregate.findMany({
      where: {
        year,
        repository: {
          githubRepositoryId: { in: [...query.repositoryIds] },
        },
      },
      select: {
        githubUserId: true,
        githubLogin: true,
        commitCount: true,
        pullRequestCount: true,
        releaseCount: true,
        updatedAt: true,
        repository: { select: { githubRepositoryId: true } },
      },
    });

    return rows.map((row) => ({
      repositoryId: row.repository.githubRepositoryId,
      githubUserId: row.githubUserId,
      githubLogin: row.githubLogin,
      year,
      dataAsOf: row.updatedAt,
      commitCount: row.commitCount,
      pullRequestCount: row.pullRequestCount,
      releaseCount: row.releaseCount,
    }));
  }

  /**
   * todo 19 — ranking 공개 페이지 소스. `getContributorMetrics`와 같은 증분 aggregate
   * 테이블(`CollectionContributorYearAggregate`)을 읽되, PUBLIC + PRESENT 저장소로 port
   * 경계에서 필터링한 뒤 githubUserId 단위로 저장소·연도를 넘어 합산한다. login이 갈리면
   * 정규화된 소문자 기준으로 가장 앞선 login을 canonical로 고른다(기존 `findRankingActivity`와
   * 동일한 tie-break) — private facts나 platform User join 없이 githubLogin만 노출한다.
   */
  async getPublicRankingMetrics(
    query: CollectionPublicRankingMetricsQueryDto,
  ): Promise<readonly CollectionPublicRankingMetricsDto[]> {
    if (query.repositoryIds.length === 0) return [];

    const rows = await this.prisma.collectionContributorYearAggregate.findMany({
      where: {
        repository: {
          githubRepositoryId: { in: [...query.repositoryIds] },
          visibility: 'PUBLIC',
          presence: 'PRESENT',
        },
        ...(query.currentYear === undefined ? {} : { year: query.currentYear }),
      },
      select: {
        githubUserId: true,
        githubLogin: true,
        commitCount: true,
        pullRequestCount: true,
        releaseCount: true,
      },
    });

    const activity = new Map<string, CollectionPublicRankingMetricsDto>();
    for (const row of rows) {
      const key = row.githubUserId.toString();
      const current = activity.get(key);
      const githubLogin =
        !current ||
        row.githubLogin.normalize().toLocaleLowerCase('en-US') <
          current.githubLogin.normalize().toLocaleLowerCase('en-US')
          ? row.githubLogin
          : current.githubLogin;
      activity.set(key, {
        githubId: row.githubUserId,
        githubLogin,
        commitCount: (current?.commitCount ?? 0) + row.commitCount,
        prCount: (current?.prCount ?? 0) + row.pullRequestCount,
        releaseCount: (current?.releaseCount ?? 0) + row.releaseCount,
      });
    }
    return [...activity.values()];
  }

  /**
   * Distinct years with any non-zero public ranking activity (PUBLIC + PRESENT).
   * Ordered newest first for the ranking shell year list.
   */
  async listPublicRankingYears(): Promise<readonly number[]> {
    const rows = await this.prisma.collectionContributorYearAggregate.findMany({
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
    });
    return rows.map((row) => row.year);
  }

  /**
   * todo 16 — `getRepositoryMetrics`와 같은 `CollectionRepositoryYearAggregate`를 읽되 `year`로
   * 필터링하지 않고 저장소별 전체 연도를 합산한다(lifetime 누적). repositoryIds 배열 크기와
   * 무관하게 findMany 질의 1개다 — 공개 프로젝트 상세/프로필 페이지의 배치 지표 조회용.
   */
  async getRepositoryCumulativeMetrics(
    query: CollectionRepositoryCumulativeMetricsQueryDto,
  ): Promise<readonly CollectionRepositoryCumulativeMetricsDto[]> {
    if (query.repositoryIds.length === 0) return [];

    const repositories = await this.prisma.collectionRepository.findMany({
      where: { githubRepositoryId: { in: [...query.repositoryIds] } },
      select: {
        githubRepositoryId: true,
        lastCompleteInventoryObservedAt: true,
        yearAggregates: {
          select: {
            commitCount: true,
            pullRequestCount: true,
            releaseCount: true,
            updatedAt: true,
          },
        },
      },
    });

    return repositories.map((repository) => {
      const dataAsOf = repository.yearAggregates.reduce<Date | null>(
        (latest, aggregate) =>
          latest === null || aggregate.updatedAt > latest
            ? aggregate.updatedAt
            : latest,
        null,
      );
      return {
        repositoryId: repository.githubRepositoryId,
        dataAsOf:
          dataAsOf ?? repository.lastCompleteInventoryObservedAt ?? new Date(),
        commitCount: repository.yearAggregates.reduce(
          (sum, aggregate) => sum + aggregate.commitCount,
          0,
        ),
        pullRequestCount: repository.yearAggregates.reduce(
          (sum, aggregate) => sum + aggregate.pullRequestCount,
          0,
        ),
        releaseCount: repository.yearAggregates.reduce(
          (sum, aggregate) => sum + aggregate.releaseCount,
          0,
        ),
      };
    });
  }

  /**
   * todo 16 — `getContributorMetrics`와 같은 `CollectionContributorYearAggregate`를 읽되
   * `year`로 필터링하지 않고 (저장소, 기여자) 조합별 전체 연도를 합산한다(lifetime 누적).
   * repositoryIds 배열 크기와 무관하게 findMany 질의 1개다 — 공개 프로젝트 상세 페이지의
   * 기여자 목록용이며 githubLogin만 노출한다(platform User join 없음).
   */
  async getContributorCumulativeMetrics(
    query: CollectionContributorCumulativeMetricsQueryDto,
  ): Promise<readonly CollectionContributorCumulativeMetricsDto[]> {
    if (query.repositoryIds.length === 0) return [];

    const rows = await this.prisma.collectionContributorYearAggregate.findMany({
      where: {
        repository: {
          githubRepositoryId: { in: [...query.repositoryIds] },
        },
      },
      select: {
        githubUserId: true,
        githubLogin: true,
        commitCount: true,
        pullRequestCount: true,
        releaseCount: true,
        updatedAt: true,
        repository: { select: { githubRepositoryId: true } },
      },
    });

    const byContributor = new Map<
      string,
      {
        repositoryId: bigint;
        githubUserId: bigint;
        githubLogin: string;
        dataAsOf: Date;
        commitCount: number;
        pullRequestCount: number;
        releaseCount: number;
      }
    >();
    for (const row of rows) {
      const key = `${row.repository.githubRepositoryId.toString()}:${row.githubUserId.toString()}`;
      const current = byContributor.get(key);
      byContributor.set(key, {
        repositoryId: row.repository.githubRepositoryId,
        githubUserId: row.githubUserId,
        githubLogin: row.githubLogin,
        dataAsOf:
          current === undefined || row.updatedAt > current.dataAsOf
            ? row.updatedAt
            : current.dataAsOf,
        commitCount: (current?.commitCount ?? 0) + row.commitCount,
        pullRequestCount:
          (current?.pullRequestCount ?? 0) + row.pullRequestCount,
        releaseCount: (current?.releaseCount ?? 0) + row.releaseCount,
      });
    }
    return [...byContributor.values()];
  }

  /**
   * todo 12 — `CollectionRepositoryStream`/`CollectionSyncCursor`(ADR-006 증분 collection)를
   * 직접 읽어 per-repo/stream 진행 상황을 집계한다. repository 이름·visibility는 절대
   * select하지 않는다 — count/시각만 반환한다. `presence: 'PRESENT'`가 아닌(관측에서 사라진)
   * 저장소는 집계에서 제외한다.
   */
  async getIncrementalStatusSnapshot(): Promise<CollectionIncrementalStatusSnapshotDto> {
    const trackedRepositoryCount = await this.prisma.collectionRepository.count(
      { where: PRESENT_REPOSITORY },
    );

    const streamGroups = await this.prisma.collectionRepositoryStream.groupBy({
      by: ['status'],
      where: { repository: PRESENT_REPOSITORY },
      _count: { _all: true },
    });
    const countFor = (status: string): number =>
      streamGroups.find((group) => group.status === status)?._count._all ?? 0;

    const readyStreamCount = countFor('READY');
    const backfillingStreamCount = countFor('BACKFILLING');
    const knownPartialStreamCount = countFor('PENDING') + countFor('VERIFYING');
    const expectedStreamCount = trackedRepositoryCount * 3;
    const observedStreamCount =
      readyStreamCount + backfillingStreamCount + knownPartialStreamCount;
    // Streams whose row hasn't been created yet (a repository just registered
    // by inventory) are effectively pending — fold them into partial too.
    const partialStreamCount =
      knownPartialStreamCount +
      Math.max(0, expectedStreamCount - observedStreamCount);

    const retryPendingWhere = {
      lastErrorCode: { not: null },
      repository: PRESENT_REPOSITORY,
    } as const;
    const retryPendingStreamCount =
      await this.prisma.collectionRepositoryStream.count({
        where: retryPendingWhere,
      });

    const [oldestReady, latest, oldestRetryPending, cursor] = await Promise.all(
      [
        this.prisma.collectionRepositoryStream.aggregate({
          where: { status: 'READY', repository: PRESENT_REPOSITORY },
          _min: { lastRunAt: true },
        }),
        this.prisma.collectionRepositoryStream.aggregate({
          where: { repository: PRESENT_REPOSITORY },
          _max: { lastRunAt: true },
        }),
        this.prisma.collectionRepositoryStream.aggregate({
          where: retryPendingWhere,
          _min: { lastErrorAt: true },
        }),
        this.prisma.collectionSyncCursor.findFirst({
          orderBy: { updatedAt: 'desc' },
          select: { cycleStartedAt: true, cycleCompletedAt: true },
        }),
      ],
    );

    return {
      trackedRepositoryCount,
      readyStreamCount,
      backfillingStreamCount,
      partialStreamCount,
      retryPendingStreamCount,
      oldestReadyCheckpointAt: oldestReady._min.lastRunAt ?? null,
      latestCheckpointAt: latest._max.lastRunAt ?? null,
      oldestRetryPendingAt: oldestRetryPending._min.lastErrorAt ?? null,
      lastCycleStartedAt: cursor?.cycleStartedAt ?? null,
      lastCycleCompletedAt: cursor?.cycleCompletedAt ?? null,
    };
  }
}
