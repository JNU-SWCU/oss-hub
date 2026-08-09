import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectionCanonicalRepository } from '../repository/collection-canonical.repository';
import { PublicRankingRepository } from '../repository/public-ranking.repository';
import { asiaSeoulYear } from '../repository/collection-incremental.repository';
import {
  COLLECTION_STREAM_TYPES,
  type CollectionStreamStatus,
} from '../collection-incremental.types';
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
  CollectionRepositoryStreamDetailDto,
  CollectionRepositoryStreamsDto,
  CollectionStatusSnapshotDto,
  CollectionStreamDetailBucketDto,
} from '../collection-read.port';

/**
 * GR-8 — `getIncrementalStatusSnapshot`은 문서상 "조직 전체 증분 collection 진행 상황"
 * 스냅샷이다(admin 화면 전용). `githubOrganizationId`가 nullable해진 뒤로는 external
 * (`EXTERNAL_PUBLIC`) 저장소도 PRESENT일 수 있으므로, org sweep 진행률에 그 저장소의
 * stream 상태가 섞여 들지 않도록 `source: 'ORG_PROVISIONED'`를 명시적으로 고정한다.
 */
const PRESENT_REPOSITORY = {
  presence: 'PRESENT',
  source: 'ORG_PROVISIONED',
} as const;

/**
 * 2026-08 owner 결정 — `getIncrementalStatusStreams`가 stream 하나를 4개 bucket 중
 * 하나로 접는다. `getIncrementalStatusSnapshot`이 쓰는 우선순위와 같다: `lastErrorCode`가
 * 있으면(재시도 대기 중) status를 무시하고 `RETRY_PENDING`이 최우선이다 —
 * `SystemStatusService.decide()`가 `retryPendingStreamCount`를 partial/backfilling보다
 * 먼저 보는 것과 같은 이유로, 한 번 READY에 도달한 뒤 poll이 실패해 status는 그대로 READY로
 * 남아 있어도(ADR-006 — 실패가 확립된 frontier를 되돌리지 않는다) 이 stream은 지금 재시도를
 * 기다리는 중이라는 신호를 우선 보여준다. status가 없으면(stream row 자체가 아직 생성되지
 * 않은 조합) `PARTIAL`이다.
 */
function classifyStreamBucket(
  status: CollectionStreamStatus | null,
  lastErrorCode: string | null,
): CollectionStreamDetailBucketDto {
  if (lastErrorCode !== null) return 'RETRY_PENDING';
  if (status === 'READY') return 'READY';
  if (status === 'BACKFILLING') return 'BACKFILLING';
  return 'PARTIAL';
}

/**
 * Asia/Seoul 달력 연도의 `[start, end)` UTC 경계.
 *
 * `Contribution` 에는 `year` 칸이 없다(ADR-010 §4) — 저장에 연도 개념을 두지 않고
 * 읽을 때 범위로만 자르기 때문이다. 그래서 새해에 롤오버 작업이 없고,
 * 같은 테이블을 프로그램 기간처럼 달력 연도가 아닌 축으로도 자를 수 있다.
 */
const seoulYearBoundsUtcForRead = (year: number): readonly [Date, Date] => [
  new Date(Date.UTC(year, 0, 1) - 9 * 60 * 60 * 1000),
  new Date(Date.UTC(year + 1, 0, 1) - 9 * 60 * 60 * 1000),
];

@Injectable()
export class CollectionReadService implements CollectionReadPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly canonicalRepository: CollectionCanonicalRepository,
    private readonly publicRanking: PublicRankingRepository,
  ) {}

  /**
   * 프로그램 표면이 읽을 수 있는 저장소 조건을 만든다.
   *
   * 조직 저장소는 그대로 허용한다. 조직 밖 저장소(`EXTERNAL_PUBLIC`)는 **신청에
   * 연결됐다는 것이 DB 로 증명될 때만** 허용한다 — 프로비저닝 테이블(`Repository`)에
   * 같은 `githubRepositoryId` 행이 있어야 한다.
   *
   * 이렇게 가르는 이유. `ADR-009` §3과 `ADR-010` §5는 학생이 `OWN` 으로 연결한 조직 밖
   * 저장소의 활동을 프로그램 실적으로 세라고 한다. 그런데 호출자가 넘기는 id 배열에
   * 학생의 **무관한** 개인 저장소가 섞이면 그것까지 조직 실적으로 조용히 집계된다.
   * `source` 로 통째 막으면 후자는 막히지만 전자도 함께 막힌다.
   *
   * 연결 증명을 조건에 넣으면 둘을 동시에 만족한다 — 연결된 것만 들어오고,
   * 그 판정을 호출자가 아니라 DB 가 한다. `Repository.githubRepositoryId` 가
   * 유니크이므로 행의 존재 자체가 증명이다.
   */
  private async linkedRepositoryFilter(
    requestedIds: readonly bigint[],
  ): Promise<Prisma.GithubRepositoryWhereInput> {
    const linked = await this.prisma.repository.findMany({
      where: { githubRepositoryId: { in: [...requestedIds] } },
      select: { githubRepositoryId: true },
    });
    const linkedIds = linked.map((row) => row.githubRepositoryId);
    return {
      OR: [
        { source: 'ORG_PROVISIONED' },
        { source: 'EXTERNAL_PUBLIC', githubRepositoryId: { in: linkedIds } },
      ],
    };
  }

  /**
   * `githubId` → GitHub login 해석.
   *
   * `Contribution` 은 집계 수치만 담고 표시명을 들지 않는다(ADR-010 §4).
   * 가입자만 적재하므로(§5) 모든 `githubId` 가 `User` 에 있고, 표시명은 거기서 온다.
   *
   * **`name`(실명) 은 select 하지 않는다.** 공개 표기는 `githubLogin` 단일이며
   * 동의 철회 endpoint 가 없는 상태에서 실명 노출은 되돌릴 수 없다(D15).
   */
  private async resolveGithubLogins(
    githubIds: readonly bigint[],
  ): Promise<ReadonlyMap<bigint, string>> {
    const unique = [...new Set(githubIds)];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { githubId: { in: unique } },
      select: { githubId: true, nickname: true },
    });
    return new Map(users.map((user) => [user.githubId, user.nickname]));
  }

  /**
   * todo 14 원자 전환 — 증분 저장소(`CollectionRepository`/facts)를 직접 읽는다. 이 포트의 유일한
   * 활성 호출자(`program-activity.service.ts`)를 새 authority로 옮기는 것이 이 메서드의 목적이다.
   * 다른 두 legacy 메서드(`findRankingActivity`/`getStatusSnapshot`)는 실제 운영 호출자가 없어
   * ADR-006의 "old generation 테이블 rollback 참조" 용도로만 old Canonical 테이블을 그대로 읽는다.
   * GR-13 — `repositoryIds`는 이 저장소가 연결된 프로그램/신청 활동을 조회하는 것이라는 의미를
   * 그대로 지키기 위해 `linkedRepositoryFilter`로 거른다(아래 메서드 참고).
   */
  async findRepositoryActivity(
    query: CollectionRepositoryActivityQueryDto,
  ): Promise<readonly CollectionRepositoryActivityDto[]> {
    if (query.repositoryIds.length === 0) return [];

    const authorWhere = query.authorGithubId
      ? { authorGithubId: query.authorGithubId }
      : undefined;

    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        githubRepositoryId: { in: [...query.repositoryIds] },
        ...(await this.linkedRepositoryFilter(query.repositoryIds)),
      },
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
      const pullRequestCount =
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
        pullRequestCount: (current?.pullRequestCount ?? 0) + pullRequestCount,
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
   * todo 11 — `Contribution`(ADR-010 §4)를 직접 읽는다.
   * `year`를 생략하면 Asia/Seoul 기준 현재 연도를 쓴다. 해당 연도 집계 행이 아직 없어도(1/1
   * rollover) 저장소 자체가 관측되어 있으면 0값 행을 반환한다 — 신규 fact write를 요구하지 않는다.
   * private/public 저장소를 가리지 않고 그대로 반환한다(private facts internally readable) —
   * eligibility 필터링은 이 포트를 호출하는 쪽(todo 15/19)의 책임이다.
   * GR-13 — `repositoryIds`는 `linkedRepositoryFilter`가 거른다: 조직 저장소이거나, 신청에 연결됐음이 DB로 증명된 조직 밖 저장소만 통과한다.
   */
  async getRepositoryMetrics(
    query: CollectionRepositoryMetricsQueryDto,
  ): Promise<readonly CollectionRepositoryMetricsDto[]> {
    if (query.repositoryIds.length === 0) return [];
    const year = query.year ?? asiaSeoulYear(new Date());
    const [yearStart, yearEnd] = seoulYearBoundsUtcForRead(year);

    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        githubRepositoryId: { in: [...query.repositoryIds] },
        ...(await this.linkedRepositoryFilter(query.repositoryIds)),
      },
      select: {
        githubRepositoryId: true,
        visibility: true,
        presence: true,
        lastCompleteInventoryObservedAt: true,
        // ADR-010 §4 재소스 — 연도 필터를 `date` 범위로 건다.
        contributions: {
          where: { date: { gte: yearStart, lt: yearEnd } },
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
      // 날짜 입자를 저장소 단위로 접는다.
      const folded = repository.contributions.reduce(
        (accumulator, row) => ({
          commitCount: accumulator.commitCount + row.commitCount,
          pullRequestCount: accumulator.pullRequestCount + row.pullRequestCount,
          releaseCount: accumulator.releaseCount + row.releaseCount,
          dataAsOf:
            accumulator.dataAsOf === null ||
            row.updatedAt > accumulator.dataAsOf
              ? row.updatedAt
              : accumulator.dataAsOf,
        }),
        {
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
          dataAsOf: null as Date | null,
        },
      );
      return {
        repositoryId: repository.githubRepositoryId,
        year,
        dataAsOf:
          folded.dataAsOf ??
          repository.lastCompleteInventoryObservedAt ??
          new Date(),
        commitCount: folded.commitCount,
        pullRequestCount: folded.pullRequestCount,
        releaseCount: folded.releaseCount,
        visibility: repository.visibility,
        presence: repository.presence,
        visibilityObservedAt: repository.lastCompleteInventoryObservedAt,
      };
    });
  }

  /**
   * todo 11 — `Contribution`(ADR-010 §4)를 직접 읽는다
   * (ranking source). repository 집계와 달리 0값 기본 행을 만들지 않는다 — 해당 연도에 실제
   * fact가 있는 (repository, contributor) 조합만 존재한다(기존 `getContributorYearAggregate`와
   * 동일한 규약).
   * GR-13 — `repositoryIds`는 `linkedRepositoryFilter`가 거른다: 조직 저장소이거나, 신청에 연결됐음이 DB로 증명된 조직 밖 저장소만 통과한다.
   * "ranking source"라는 위 표현은 `getRepositoryMetrics`와 같은 batch-by-id aggregate라는
   * 뜻이며, 학생 개인 이력을 의도적으로 섞는 `getPublicRankingMetrics`(org 밖 저장소도 포함)와는
   * 다르다 — 이 메서드는 현재 실운영 호출자가 없다. 나중에 이 메서드를 개인 랭킹 용도로 새로
   * 배선한다면 이 가드를 그대로 두는 게 맞는지 다시 판단해야 한다.
   */
  async getContributorMetrics(
    query: CollectionContributorMetricsQueryDto,
  ): Promise<readonly CollectionContributorMetricsDto[]> {
    if (query.repositoryIds.length === 0) return [];
    const year = query.year ?? asiaSeoulYear(new Date());

    // ADR-010 §4 재소스 — 옛 연도 집계 대신 `Contribution` 을 읽는다.
    //
    // 연도 필터는 저장이 아니라 조회에서 한다. `Contribution` 에는 `year` 칸이
    // 없으므로 Asia/Seoul 연 경계로 `date` 범위를 잡는다 — 그래서 새해에
    // 롤오버 작업이 필요 없다.
    const [yearStart, yearEnd] = seoulYearBoundsUtcForRead(year);

    const rows = await this.prisma.contribution.findMany({
      where: {
        date: { gte: yearStart, lt: yearEnd },
        repository: {
          githubRepositoryId: { in: [...query.repositoryIds] },
          ...(await this.linkedRepositoryFilter(query.repositoryIds)),
        },
      },
      select: {
        githubId: true,
        commitCount: true,
        pullRequestCount: true,
        releaseCount: true,
        updatedAt: true,
        repository: { select: { githubRepositoryId: true } },
      },
    });

    // 날짜 입자를 (저장소, 사람) 단위로 접는다.
    const folded = new Map<
      string,
      {
        repositoryId: bigint;
        githubId: bigint;
        dataAsOf: Date;
        commitCount: number;
        pullRequestCount: number;
        releaseCount: number;
      }
    >();
    for (const row of rows) {
      const key = `${row.repository.githubRepositoryId}:${row.githubId}`;
      const current = folded.get(key);
      if (current === undefined) {
        folded.set(key, {
          repositoryId: row.repository.githubRepositoryId,
          githubId: row.githubId,
          dataAsOf: row.updatedAt,
          commitCount: row.commitCount,
          pullRequestCount: row.pullRequestCount,
          releaseCount: row.releaseCount,
        });
        continue;
      }
      current.commitCount += row.commitCount;
      current.pullRequestCount += row.pullRequestCount;
      current.releaseCount += row.releaseCount;
      if (row.updatedAt > current.dataAsOf) current.dataAsOf = row.updatedAt;
    }

    // `githubLogin` 은 `Contribution` 이 들지 않는다(ADR-010 §4 — 집계 수치만 보관).
    // 가입자만 적재하므로(§5) 모든 `githubId` 는 `User` 에 있고, 표시명은 거기서 온다.
    // **`name`(실명) 은 select 하지 않는다** — 공개 표기는 `githubLogin` 단일이다(D3).
    const logins = await this.resolveGithubLogins(
      [...folded.values()].map((entry) => entry.githubId),
    );

    return [...folded.values()].map((entry) => ({
      repositoryId: entry.repositoryId,
      githubUserId: entry.githubId,
      githubLogin: logins.get(entry.githubId) ?? '',
      year,
      dataAsOf: entry.dataAsOf,
      commitCount: entry.commitCount,
      pullRequestCount: entry.pullRequestCount,
      releaseCount: entry.releaseCount,
    }));
  }

  /**
   * ranking 공개 페이지 소스 — 전용 public query repository 로 위임한다.
   *
   * 랭킹 endpoint 에는 가드가 없고 읽는 대상은 private 테이블이다.
   * 그 조합은 owner-approved dedicated public query repository 안에서만
   * 허용되므로(`AGENTS.md` §4), 이 서비스는 질의를 직접 쓰지 않는다.
   */
  async getPublicRankingMetrics(
    query: CollectionPublicRankingMetricsQueryDto,
  ): Promise<readonly CollectionPublicRankingMetricsDto[]> {
    return this.publicRanking.findMetrics(query);
  }

  /** 공개 랭킹 수치와 별도로 읽는 마지막 수집 성공 시각(ADR-010 §10). */
  async getPublicRankingDataAsOf(): Promise<Date | null> {
    return this.publicRanking.findDataAsOf();
  }

  /** 공개 랭킹 활동이 있는 연도 목록, 최신 순. */
  async listPublicRankingYears(): Promise<readonly number[]> {
    return this.publicRanking.listYears();
  }

  /**
   * todo 16 — `getRepositoryMetrics`와 같은 `Contribution`을 읽되 `year`로
   * 필터링하지 않고 저장소별 전체 연도를 합산한다(lifetime 누적). repositoryIds 배열 크기와
   * 무관하게 findMany 질의 1개다 — 공개 프로젝트 상세/프로필 페이지의 배치 지표 조회용.
   * GR-13 — 호출자(`public-projects.service.ts`)가 넘기는 id는 프로그램 신청에 연결된 저장소
   * (`PublicShowcaseRepository`/구 `Repository` 파생)뿐이므로 `repositoryIds`는
   * `linkedRepositoryFilter`로 거른다(아래 메서드 참고).
   */
  async getRepositoryCumulativeMetrics(
    query: CollectionRepositoryCumulativeMetricsQueryDto,
  ): Promise<readonly CollectionRepositoryCumulativeMetricsDto[]> {
    if (query.repositoryIds.length === 0) return [];

    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        githubRepositoryId: { in: [...query.repositoryIds] },
        visibility: 'PUBLIC',
        presence: 'PRESENT',
        ...(await this.linkedRepositoryFilter(query.repositoryIds)),
      },
      select: {
        githubRepositoryId: true,
        lastCompleteInventoryObservedAt: true,
        // ADR-010 §4 재소스 — 옛 연도 집계 대신 `Contribution` 을 합산한다.
        // 누적이므로 기간 필터가 없다.
        contributions: {
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
      const dataAsOf = repository.contributions.reduce<Date | null>(
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
        commitCount: repository.contributions.reduce(
          (sum, aggregate) => sum + aggregate.commitCount,
          0,
        ),
        pullRequestCount: repository.contributions.reduce(
          (sum, aggregate) => sum + aggregate.pullRequestCount,
          0,
        ),
        releaseCount: repository.contributions.reduce(
          (sum, aggregate) => sum + aggregate.releaseCount,
          0,
        ),
      };
    });
  }

  /**
   * todo 16 — `getContributorMetrics`와 같은 `Contribution`을 읽되
   * `year`로 필터링하지 않고 (저장소, 기여자) 조합별 전체 연도를 합산한다(lifetime 누적).
   * repositoryIds 배열 크기와 무관하게 findMany 질의 1개다 — 공개 프로젝트 상세 페이지의
   * 기여자 목록용이며 githubLogin만 노출한다(platform User join 없음).
   * GR-13 — `repositoryIds`는 `linkedRepositoryFilter`가 거른다: 조직 저장소이거나, 신청에 연결됐음이 DB로 증명된 조직 밖 저장소만 통과한다.
   */
  async getContributorCumulativeMetrics(
    query: CollectionContributorCumulativeMetricsQueryDto,
  ): Promise<readonly CollectionContributorCumulativeMetricsDto[]> {
    if (query.repositoryIds.length === 0) return [];

    // ADR-010 §4 재소스 — 누적이므로 기간 필터가 없다.
    const rows = await this.prisma.contribution.findMany({
      where: {
        repository: {
          githubRepositoryId: { in: [...query.repositoryIds] },
          visibility: 'PUBLIC',
          presence: 'PRESENT',
          ...(await this.linkedRepositoryFilter(query.repositoryIds)),
        },
      },
      select: {
        githubId: true,
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
      const key = `${row.repository.githubRepositoryId.toString()}:${row.githubId.toString()}`;
      const current = byContributor.get(key);
      byContributor.set(key, {
        repositoryId: row.repository.githubRepositoryId,
        githubUserId: row.githubId,
        githubLogin: '',
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

    // 표시명은 `User` 가 단일 원본이다(ADR-010 §4 — Contribution 은 수치만 담는다).
    const logins = await this.resolveGithubLogins(
      [...byContributor.values()].map((entry) => entry.githubUserId),
    );
    return [...byContributor.values()].map((entry) => ({
      ...entry,
      githubLogin: logins.get(entry.githubUserId) ?? '',
    }));
  }

  /**
   * todo 12 — `CollectionRepositoryStream`/`CollectionSyncCursor`(ADR-006 증분 collection)를
   * 직접 읽어 per-repo/stream 진행 상황을 집계한다. repository 이름·visibility는 절대
   * select하지 않는다 — count/시각만 반환한다. `presence: 'PRESENT'`가 아닌(관측에서 사라진)
   * 저장소는 집계에서 제외한다.
   */
  async getIncrementalStatusSnapshot(): Promise<CollectionIncrementalStatusSnapshotDto> {
    const trackedRepositoryCount = await this.prisma.githubRepository.count({
      where: PRESENT_REPOSITORY,
    });

    // 큐 건강 (ADR-010 §6·§10) — 저장소 이름·식별자를 담지 않는다.
    const now = new Date();
    const [dueRepositoryCount, failingRepositoryCount, lastSuccess] =
      await Promise.all([
        this.prisma.githubRepository.count({
          where: { ...PRESENT_REPOSITORY, nextRunAt: { lte: now } },
        }),
        this.prisma.githubRepository.count({
          where: { ...PRESENT_REPOSITORY, failureCount: { gt: 0 } },
        }),
        this.prisma.githubRepository.aggregate({
          where: PRESENT_REPOSITORY,
          _max: { lastSuccessAt: true },
        }),
      ]);

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
      dueRepositoryCount,
      failingRepositoryCount,
      lastRepositorySuccessAt: lastSuccess._max.lastSuccessAt ?? null,
    };
  }

  /**
   * 2026-08 owner 결정 — ADMIN 전용 system-status 화면의 저장소·stream 상세(위
   * `collection-read.port.ts`의 `CollectionRepositoryStreamsDto` 참고). `getIncrementalStatusSnapshot`과
   * 같은 `PRESENT_REPOSITORY` 조건으로 추적 대상을 고르고, 각 저장소의 stream 3개를
   * `nameWithOwner` 관계 join 1개(N+1 없음)로 가져온다. `classifyStreamBucket`이
   * 집계 쪽 우선순위(재시도 대기 > backfilling/ready > partial)를 stream 단위로 반복한다.
   */
  async getIncrementalStatusStreams(): Promise<
    readonly CollectionRepositoryStreamsDto[]
  > {
    const repositories = await this.prisma.githubRepository.findMany({
      where: PRESENT_REPOSITORY,
      orderBy: { nameWithOwner: 'asc' },
      select: {
        nameWithOwner: true,
        streams: {
          select: {
            streamType: true,
            status: true,
            lastRunAt: true,
            lastErrorCode: true,
            lastErrorAt: true,
          },
        },
      },
    });

    return repositories.map((repository) => {
      const byType = new Map(
        repository.streams.map((stream) => [stream.streamType, stream]),
      );
      const streams: CollectionRepositoryStreamDetailDto[] =
        COLLECTION_STREAM_TYPES.map((streamType) => {
          const row = byType.get(streamType);
          return {
            streamType,
            bucket: classifyStreamBucket(
              row?.status ?? null,
              row?.lastErrorCode ?? null,
            ),
            lastSuccessAt: row?.lastRunAt ?? null,
            lastErrorCode: row?.lastErrorCode ?? null,
            lastErrorAt: row?.lastErrorAt ?? null,
          };
        });
      return { repositoryName: repository.nameWithOwner, streams };
    });
  }
}
