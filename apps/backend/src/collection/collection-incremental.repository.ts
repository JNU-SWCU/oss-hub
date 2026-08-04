import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CollectionRepositoryRow,
  CommitFactInput,
  ContributorYearAggregateRow,
  PullRequestFactInput,
  RecordFactsResult,
  RecordRepositoryObservationInput,
  ReleaseFactInput,
  RepositoryYearAggregateRow,
  StreamFrontierInput,
  StreamFrontierRow,
  SyncCursorInput,
  SyncCursorRow,
} from './collection-incremental.types';
import { zeroRepositoryYearAggregate } from './collection-incremental.types';
import type {
  AcquireSyncLeaseInput,
  SyncLeaseToken,
} from './collection-sync.types';

/** Asia/Seoul(UTC+9, DST 없음) 기준 연도. */
export const asiaSeoulYear = (at: Date): number =>
  new Date(at.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();

/**
 * 주어진 Asia/Seoul 달력 연도의 `[start, end)` UTC 경계. `asiaSeoulYear`의 역함수 —
 * 이 구간에 속하는 시각은 전부 그 해로 계산된다(1/1 00:00:00 KST = 전년도 12/31 15:00:00 UTC).
 */
const seoulYearBoundsUtc = (year: number): readonly [Date, Date] => [
  new Date(Date.UTC(year, 0, 1) - 9 * 60 * 60 * 1000),
  new Date(Date.UTC(year + 1, 0, 1) - 9 * 60 * 60 * 1000),
];

/** rebuild 대상 (year, githubUserId) 쌍 — githubUserId는 repository 전체 집계에는 쓰이지 않는다. */
interface AffectedYear {
  year: number;
  githubUserId: bigint | null;
}

@Injectable()
export class CollectionIncrementalRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Runs `fn` against a repository instance scoped to one Prisma interactive
   * transaction — a mid-callback throw rolls back every write `fn` made
   * through it. Used by the todo 8 generation import command so a failure
   * partway through one repository's facts/streams never leaves that
   * repository in a half-imported state (the run simply does not progress
   * for that repository, and can be retried from scratch next time).
   */
  async runInTransaction<T>(
    fn: (repo: CollectionIncrementalRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction((tx) =>
      fn(new CollectionIncrementalRepository(tx as unknown as PrismaService)),
    );
  }

  /**
   * complete inventory 관찰 1건을 반영한다. visibility/presence 갱신은 이 경로로만
   * 일어난다(DEC-46) — partial 관찰은 이 메서드를 호출하지 않는다. upsert 식별자는
   * `githubRepositoryId` 단독이다(GitHub repository id는 전역 유일) — org sweep과 external
   * sweep이 같은 저장소를 서로 다른 관찰로 덮어쓰는 충돌은 발생하지 않는다(둘은 서로소인
   * 저장소 집합을 관찰한다).
   */
  async recordRepositoryObservation(
    input: RecordRepositoryObservationInput,
  ): Promise<CollectionRepositoryRow> {
    return this.db.githubRepository.upsert({
      where: { githubRepositoryId: input.githubRepositoryId },
      create: {
        githubOrganizationId: input.githubOrganizationId,
        githubRepositoryId: input.githubRepositoryId,
        nameWithOwner: input.nameWithOwner,
        defaultBranch: input.defaultBranch,
        archived: input.archived,
        visibility: input.visibility,
        presence: input.presence,
        source: input.source,
        lastCompleteInventoryObservedAt: input.observedAt,
      },
      update: {
        githubOrganizationId: input.githubOrganizationId,
        nameWithOwner: input.nameWithOwner,
        defaultBranch: input.defaultBranch,
        archived: input.archived,
        visibility: input.visibility,
        presence: input.presence,
        source: input.source,
        lastCompleteInventoryObservedAt: input.observedAt,
      },
    });
  }

  /** 단일 unique key(`githubRepositoryId`)로 저장소를 조회한다 — source와 무관하다. */
  async findRepositoryByLogicalKey(
    githubRepositoryId: bigint,
  ): Promise<CollectionRepositoryRow | null> {
    return this.db.githubRepository.findUnique({
      where: { githubRepositoryId },
    });
  }

  /**
   * `createMany`+`skipDuplicates`는 Postgres `INSERT ... ON CONFLICT DO NOTHING`으로
   * 컴파일된다 — 중복 fact(재시도/overlap)는 조용히 건너뛰고 정확한 신규 삽입 수만
   * 반환한다. 그 뒤 이번 배치가 건드린 (year[, contributor]) 집합만 facts 테이블에서
   * 다시 COUNT해 **덮어쓴다** — 순서·중복 여부와 무관하게 항상 같은 결과가 되는
   * deterministic rebuild이며, 이미 존재하던 중복 fact를 다시 보낸 재시도도 동일하게
   * 안전하다(rebuild는 source-of-truth를 다시 세는 것이지 증가시키는 것이 아니다).
   */
  async recordCommitFacts(
    repositoryId: string,
    facts: readonly CommitFactInput[],
  ): Promise<RecordFactsResult> {
    if (facts.length === 0) return { insertedCount: 0 };
    const { count: insertedCount } =
      await this.db.collectionCommitFact.createMany({
        data: facts.map((fact) => ({
          repositoryId,
          sha: fact.sha,
          committedAt: fact.committedAt,
          authorGithubId: fact.authorGithubId ?? null,
          authorGithubLogin: fact.authorGithubLogin ?? null,
        })),
        skipDuplicates: true,
      });
    await this.rebuildAffectedAggregates(
      repositoryId,
      facts.map((fact) => ({
        year: asiaSeoulYear(fact.committedAt),
        githubUserId: fact.authorGithubId ?? null,
      })),
    );
    return { insertedCount };
  }

  async recordPullRequestFacts(
    repositoryId: string,
    facts: readonly PullRequestFactInput[],
  ): Promise<RecordFactsResult> {
    if (facts.length === 0) return { insertedCount: 0 };
    const { count: insertedCount } =
      await this.db.collectionPullRequestFact.createMany({
        data: facts.map((fact) => ({
          repositoryId,
          githubPullRequestId: fact.githubPullRequestId,
          state: fact.state,
          createdAt: fact.createdAt,
          authorGithubId: fact.authorGithubId ?? null,
          authorGithubLogin: fact.authorGithubLogin ?? null,
        })),
        skipDuplicates: true,
      });
    await this.rebuildAffectedAggregates(
      repositoryId,
      facts.map((fact) => ({
        year: asiaSeoulYear(fact.createdAt),
        githubUserId: fact.authorGithubId ?? null,
      })),
    );
    return { insertedCount };
  }

  async recordReleaseFacts(
    repositoryId: string,
    facts: readonly ReleaseFactInput[],
  ): Promise<RecordFactsResult> {
    if (facts.length === 0) return { insertedCount: 0 };
    const { count: insertedCount } =
      await this.db.collectionReleaseFact.createMany({
        data: facts.map((fact) => ({
          repositoryId,
          githubReleaseId: fact.githubReleaseId,
          publishedAt: fact.publishedAt,
          authorGithubId: fact.authorGithubId ?? null,
          authorGithubLogin: fact.authorGithubLogin ?? null,
        })),
        skipDuplicates: true,
      });
    await this.rebuildAffectedAggregates(
      repositoryId,
      facts.map((fact) => ({
        year: asiaSeoulYear(fact.publishedAt),
        githubUserId: fact.authorGithubId ?? null,
      })),
    );
    return { insertedCount };
  }

  /**
   * 이번 배치가 건드린 (repositoryId, year) 전체와 (repositoryId, githubUserId, year)
   * 전체를 facts 테이블 COUNT로부터 다시 계산해 덮어쓴다. null author는 repository
   * 총계에는 포함되지만(위 3-way COUNT가 author 조건 없이 전체를 센다) contributor
   * 집계 행에서는 제외된다.
   */
  private async rebuildAffectedAggregates(
    repositoryId: string,
    affected: readonly AffectedYear[],
  ): Promise<void> {
    const years = new Set(affected.map((entry) => entry.year));
    for (const year of years) {
      await this.rebuildRepositoryYearAggregate(repositoryId, year);
    }

    const contributors = new Map<
      string,
      { githubUserId: bigint; year: number }
    >();
    for (const entry of affected) {
      if (entry.githubUserId === null) continue;
      contributors.set(`${entry.githubUserId}:${entry.year}`, {
        githubUserId: entry.githubUserId,
        year: entry.year,
      });
    }
    for (const { githubUserId, year } of contributors.values()) {
      await this.rebuildContributorYearAggregate(
        repositoryId,
        githubUserId,
        year,
      );
    }
  }

  /** repository 단위 연도 집계를 facts 테이블 COUNT로 재계산해 그대로 덮어쓴다(증가 아님). */
  private async rebuildRepositoryYearAggregate(
    repositoryId: string,
    year: number,
  ): Promise<void> {
    const [start, end] = seoulYearBoundsUtc(year);
    const [commitCount, pullRequestCount, releaseCount] = await Promise.all([
      this.db.collectionCommitFact.count({
        where: { repositoryId, committedAt: { gte: start, lt: end } },
      }),
      this.db.collectionPullRequestFact.count({
        where: { repositoryId, createdAt: { gte: start, lt: end } },
      }),
      this.db.collectionReleaseFact.count({
        where: { repositoryId, publishedAt: { gte: start, lt: end } },
      }),
    ]);
    await this.db.collectionRepositoryYearAggregate.upsert({
      where: { repositoryId_year: { repositoryId, year } },
      create: {
        repositoryId,
        year,
        commitCount,
        pullRequestCount,
        releaseCount,
      },
      update: { commitCount, pullRequestCount, releaseCount },
    });
  }

  /** contributor 단위 연도 집계를 facts 테이블 COUNT로 재계산해 그대로 덮어쓴다(증가 아님). */
  private async rebuildContributorYearAggregate(
    repositoryId: string,
    githubUserId: bigint,
    year: number,
  ): Promise<void> {
    const [start, end] = seoulYearBoundsUtc(year);
    const [commitCount, pullRequestCount, releaseCount, latestLogin] =
      await Promise.all([
        this.db.collectionCommitFact.count({
          where: {
            repositoryId,
            authorGithubId: githubUserId,
            committedAt: { gte: start, lt: end },
          },
        }),
        this.db.collectionPullRequestFact.count({
          where: {
            repositoryId,
            authorGithubId: githubUserId,
            createdAt: { gte: start, lt: end },
          },
        }),
        this.db.collectionReleaseFact.count({
          where: {
            repositoryId,
            authorGithubId: githubUserId,
            publishedAt: { gte: start, lt: end },
          },
        }),
        this.findLatestGithubLogin(repositoryId, githubUserId, start, end),
      ]);
    const githubLogin = latestLogin ?? '';
    await this.db.collectionContributorYearAggregate.upsert({
      where: {
        repositoryId_githubUserId_year: { repositoryId, githubUserId, year },
      },
      create: {
        repositoryId,
        githubUserId,
        githubLogin,
        year,
        commitCount,
        pullRequestCount,
        releaseCount,
      },
      update: { githubLogin, commitCount, pullRequestCount, releaseCount },
    });
  }

  /**
   * 세 fact 스트림을 통틀어 가장 최근에 관측된 login을 고른다 — GitHub login 변경(rename)이
   * 있어도 매번 결정적으로 같은 값을 고르기 위해 "가장 최근 관측"을 tie-break 기준으로 쓴다.
   */
  private async findLatestGithubLogin(
    repositoryId: string,
    githubUserId: bigint,
    start: Date,
    end: Date,
  ): Promise<string | null> {
    const [commit, pullRequest, release] = await Promise.all([
      this.db.collectionCommitFact.findFirst({
        where: {
          repositoryId,
          authorGithubId: githubUserId,
          committedAt: { gte: start, lt: end },
        },
        orderBy: { committedAt: 'desc' },
        select: { authorGithubLogin: true, committedAt: true },
      }),
      this.db.collectionPullRequestFact.findFirst({
        where: {
          repositoryId,
          authorGithubId: githubUserId,
          createdAt: { gte: start, lt: end },
        },
        orderBy: { createdAt: 'desc' },
        select: { authorGithubLogin: true, createdAt: true },
      }),
      this.db.collectionReleaseFact.findFirst({
        where: {
          repositoryId,
          authorGithubId: githubUserId,
          publishedAt: { gte: start, lt: end },
        },
        orderBy: { publishedAt: 'desc' },
        select: { authorGithubLogin: true, publishedAt: true },
      }),
    ]);
    const candidates: Array<{ at: Date; login: string | null }> = [];
    if (commit)
      candidates.push({
        at: commit.committedAt,
        login: commit.authorGithubLogin,
      });
    if (pullRequest) {
      candidates.push({
        at: pullRequest.createdAt,
        login: pullRequest.authorGithubLogin,
      });
    }
    if (release) {
      candidates.push({
        at: release.publishedAt,
        login: release.authorGithubLogin,
      });
    }
    if (candidates.length === 0) return null;
    candidates.sort((left, right) => right.at.getTime() - left.at.getTime());
    const [latest] = candidates;
    return latest ? latest.login : null;
  }

  /** 존재하지 않는 연도는 0으로 채워 반환한다 — 매년 1/1 read가 안전하다. */
  async getRepositoryYearAggregate(
    repositoryId: string,
    year: number,
  ): Promise<RepositoryYearAggregateRow> {
    const row = await this.db.collectionRepositoryYearAggregate.findUnique({
      where: { repositoryId_year: { repositoryId, year } },
    });
    return row ?? zeroRepositoryYearAggregate(repositoryId, year);
  }

  async getContributorYearAggregate(
    repositoryId: string,
    githubUserId: bigint,
    year: number,
  ): Promise<ContributorYearAggregateRow | null> {
    return this.db.collectionContributorYearAggregate.findUnique({
      where: {
        repositoryId_githubUserId_year: { repositoryId, githubUserId, year },
      },
    });
  }

  async upsertStreamFrontier(
    input: StreamFrontierInput,
  ): Promise<StreamFrontierRow> {
    return this.db.collectionRepositoryStream.upsert({
      where: {
        repositoryId_streamType: {
          repositoryId: input.repositoryId,
          streamType: input.streamType,
        },
      },
      create: {
        repositoryId: input.repositoryId,
        streamType: input.streamType,
        status: input.status ?? 'PENDING',
        frontierSha: input.frontierSha ?? null,
        frontierCreatedAt: input.frontierCreatedAt ?? null,
        frontierEntityId: input.frontierEntityId ?? null,
        requestFingerprint: input.requestFingerprint ?? null,
        etag: input.etag ?? null,
        lastRunAt: input.lastRunAt ?? null,
        lastErrorAt: input.lastErrorAt ?? null,
        lastErrorCode: input.lastErrorCode ?? null,
      },
      update: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.frontierSha !== undefined
          ? { frontierSha: input.frontierSha }
          : {}),
        ...(input.frontierCreatedAt !== undefined
          ? { frontierCreatedAt: input.frontierCreatedAt }
          : {}),
        ...(input.frontierEntityId !== undefined
          ? { frontierEntityId: input.frontierEntityId }
          : {}),
        ...(input.requestFingerprint !== undefined
          ? { requestFingerprint: input.requestFingerprint }
          : {}),
        ...(input.etag !== undefined ? { etag: input.etag } : {}),
        ...(input.lastRunAt !== undefined
          ? { lastRunAt: input.lastRunAt }
          : {}),
        ...(input.lastErrorAt !== undefined
          ? { lastErrorAt: input.lastErrorAt }
          : {}),
        ...(input.lastErrorCode !== undefined
          ? { lastErrorCode: input.lastErrorCode }
          : {}),
      },
    });
  }

  async getStreamFrontier(
    repositoryId: string,
    streamType: StreamFrontierInput['streamType'],
  ): Promise<StreamFrontierRow | null> {
    return this.db.collectionRepositoryStream.findUnique({
      where: { repositoryId_streamType: { repositoryId, streamType } },
    });
  }

  async upsertSyncCursor(input: SyncCursorInput): Promise<SyncCursorRow> {
    return this.db.collectionSyncCursor.upsert({
      where: {
        appId_scope: {
          appId: input.appId,
          scope: input.scope,
        },
      },
      create: {
        appId: input.appId,
        scope: input.scope,
        lastGithubRepositoryId: input.lastGithubRepositoryId ?? null,
        cycleStartedAt: input.cycleStartedAt ?? null,
        cycleCompletedAt: input.cycleCompletedAt ?? null,
      },
      update: {
        ...(input.lastGithubRepositoryId !== undefined
          ? { lastGithubRepositoryId: input.lastGithubRepositoryId }
          : {}),
        ...(input.cycleStartedAt !== undefined
          ? { cycleStartedAt: input.cycleStartedAt }
          : {}),
        ...(input.cycleCompletedAt !== undefined
          ? { cycleCompletedAt: input.cycleCompletedAt }
          : {}),
      },
    });
  }

  async getSyncCursor(
    appId: bigint,
    scope: string,
  ): Promise<SyncCursorRow | null> {
    return this.db.collectionSyncCursor.findUnique({
      where: { appId_scope: { appId, scope } },
    });
  }

  /**
   * complete inventory 관찰 이후 더 이상 목록에 없는 저장소를 ABSENT로 표시한다 — 이 경로 역시
   * DEC-46(visibility/presence는 complete inventory 관찰에서만 갱신)을 지키며, 호출자가 lease-fenced
   * 트랜잭션(`runInTransaction` + `assertSyncLeaseValid`) 안에서 호출한다.
   *
   * `source: 'ORG_PROVISIONED'`를 명시적으로 포함한다(GR-6) — `EXTERNAL_PUBLIC` 저장소는
   * organization installation listing에 애초에 나타나지 않으므로, 이 필터가 없으면 매
   * org sweep마다 학생이 등록한 external repo가 전부 ABSENT로 잘못 표시되어 조용히 추적이
   * 끊긴다. `githubOrganizationId`가 org sweep 관찰에서는 항상 채워지지만, 그 값의
   * non-null 여부에만 기대지 않고 source를 별도로 명시한다.
   */
  async markAbsentRepositories(
    githubOrganizationId: bigint,
    presentGithubRepositoryIds: readonly bigint[],
    observedAt: Date,
  ): Promise<void> {
    await this.db.githubRepository.updateMany({
      where: {
        githubOrganizationId,
        source: 'ORG_PROVISIONED',
        presence: 'PRESENT',
        githubRepositoryId: { notIn: [...presentGithubRepositoryIds] },
      },
      data: { presence: 'ABSENT', lastCompleteInventoryObservedAt: observedAt },
    });
  }

  /**
   * partial inventory(이번 run의 provider listing 실패) 시 stream sync가 이어갈 이전 관찰.
   * `source: 'ORG_PROVISIONED'`를 명시한다(GR-6) — org installation listing 실패로부터
   * 복구하는 partial-inventory 경로이므로 external 저장소는 이 조회 대상이 아니다.
   */
  async listPresentRepositories(
    githubOrganizationId: bigint,
  ): Promise<CollectionRepositoryRow[]> {
    return this.db.githubRepository.findMany({
      where: { githubOrganizationId, source: 'ORG_PROVISIONED', presence: 'PRESENT' },
    });
  }

  /**
   * E1 — external sweep의 discovery. 자동 GraphQL 발견(추후 과제)이 아니라, 학생이 이미
   * 등록해 `EXTERNAL_PUBLIC` source로 저장된 행을 그대로 읽는다. org sweep의
   * `syncInventory`(provider listing → observation 기록)와 달리 이 메서드는 관찰을 쓰지
   * 않는다 — 단순 조회다.
   */
  async listExternalRepositories(): Promise<CollectionRepositoryRow[]> {
    return this.db.githubRepository.findMany({
      where: { source: 'EXTERNAL_PUBLIC', presence: 'PRESENT' },
    });
  }

  /**
   * `CollectionSyncLease`를 획득한다 — 만료된 lease만 epoch을 증가시키며 훔칠 수 있다
   * (`CanonicalCollectionRepository.acquireLease`와 동일한 fencing 패턴, 별도 run 후보 테이블 없음).
   */
  async acquireSyncLease(
    input: AcquireSyncLeaseInput,
  ): Promise<SyncLeaseToken | null> {
    const rows = await this.db.$queryRawUnsafe<SyncLeaseToken[]>(
      `INSERT INTO "CollectionSyncLease" ("appId", "scope", "epoch", "ownerId", "expiresAt", "runId", "updatedAt")
       VALUES ($1, $2, 1, $3, $4, $5, $6)
       ON CONFLICT ("appId", "scope") DO UPDATE SET
         "epoch" = "CollectionSyncLease"."epoch" + 1, "ownerId" = EXCLUDED."ownerId",
         "expiresAt" = EXCLUDED."expiresAt", "runId" = EXCLUDED."runId", "updatedAt" = EXCLUDED."updatedAt"
       WHERE "CollectionSyncLease"."expiresAt" <= $6
       RETURNING "appId", "scope", "ownerId", "epoch", "runId", "expiresAt"`,
      input.appId,
      input.scope,
      input.ownerId,
      input.expiresAt,
      input.runId,
      input.now,
    );
    return rows[0] ?? null;
  }

  async heartbeatSyncLease(
    token: SyncLeaseToken,
    now: Date,
    expiresAt: Date,
  ): Promise<void> {
    const count = await this.db.$executeRawUnsafe(
      `UPDATE "CollectionSyncLease" SET "expiresAt" = $6, "updatedAt" = $5
       WHERE "appId" = $1 AND "scope" = $2 AND "ownerId" = $3 AND "epoch" = $4 AND "expiresAt" > $5 AND "runId" = $7`,
      token.appId,
      token.scope,
      token.ownerId,
      token.epoch,
      now,
      expiresAt,
      token.runId,
    );
    if (count !== 1) throw new Error('Collection sync lease is stale');
  }

  /** best-effort 정리 — 이미 다른 owner가 훔친 lease라면 아무 것도 하지 않는다. */
  async releaseSyncLease(token: SyncLeaseToken, now: Date): Promise<void> {
    await this.db.$executeRawUnsafe(
      `UPDATE "CollectionSyncLease" SET "expiresAt" = $6, "updatedAt" = $6
       WHERE "appId" = $1 AND "scope" = $2 AND "ownerId" = $3 AND "epoch" = $4 AND "runId" = $5`,
      token.appId,
      token.scope,
      token.ownerId,
      token.epoch,
      token.runId,
      now,
    );
  }

  /**
   * 매 fenced 트랜잭션의 첫 문장으로 호출한다 — `SELECT ... FOR UPDATE`로 현재 트랜잭션 안에서
   * lease 소유권을 잠그고 확인한다(`CanonicalCollectionRepository.assertLease`와 동일 패턴).
   * stale이면 그 트랜잭션의 모든 쓰기가 커밋되지 않는다.
   */
  async assertSyncLeaseValid(token: SyncLeaseToken, now: Date): Promise<void> {
    const rows = await this.db.$queryRawUnsafe<Array<{ owned: boolean }>>(
      `SELECT true AS "owned" FROM "CollectionSyncLease" WHERE "appId" = $1 AND "scope" = $2
       AND "ownerId" = $3 AND "epoch" = $4 AND "runId" = $5 AND "expiresAt" > $6 FOR UPDATE`,
      token.appId,
      token.scope,
      token.ownerId,
      token.epoch,
      token.runId,
      now,
    );
    if (!rows[0]) throw new Error('Collection sync lease is stale');
  }
}
