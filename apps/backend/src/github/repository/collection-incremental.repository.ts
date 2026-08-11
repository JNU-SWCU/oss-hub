import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CollectionRepositoryRow,
  CollectionSyncRunRow,
  CollectionSyncRunTrigger,
  CollectionSyncStreamSummary,
  CommitFactInput,
  PullRequestFactInput,
  RecordFactsResult,
  RecordRepositoryObservationInput,
  RecordSweepHistoryInput,
  RegisteredGithubIdSet,
  ReleaseFactInput,
  RepositorySource,
  RepositoryTeamMemberAccount,
  StreamFrontierInput,
  StreamFrontierRow,
  SyncCursorInput,
  SyncCursorRow,
} from '../collection-incremental.types';
import type {
  AcquireSyncLeaseInput,
  SyncLeaseToken,
} from '../collection-sync.types';

/** Asia/Seoul(UTC+9, DST 없음) 기준 연도. */
export const asiaSeoulYear = (at: Date): number =>
  new Date(at.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();

/**
 * Asia/Seoul 기준 날짜(자정)를 UTC `Date`로. `Contribution.date`(@db.Date)의 키다.
 *
 * 날짜 경계 해석을 이 함수 하나에 가둔다 — 쓰기 지점마다 각자 자르면
 * 같은 커밋이 호출자에 따라 다른 날에 붙는다.
 */
export const asiaSeoulDate = (at: Date): Date => {
  const shifted = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ),
  );
};

/** 정기 수집 주기 — 매시 1회(ADR-010 §10). */
const REGULAR_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 연속 실패에 대한 지수 백오프. 상한 6시간.
 *
 * 상한이 없으면 오래 실패한 저장소가 사실상 영구 제외되는데, 그건 이 변경이
 * 없애려던 상태(하나가 막히면 영영 안 돌아온다)와 결과가 같다.
 */
const backoffMs = (failureCount: number): number =>
  Math.min(
    REGULAR_INTERVAL_MS * 2 ** Math.min(failureCount - 1, 6),
    6 * 60 * 60 * 1000,
  );

/** external sweep이 쓰는 고정 scope — `collection-sync.service.ts`의 `EXTERNAL_SCOPE`와 한 벌이다. */
const EXTERNAL_SCOPE = 'external';

/**
 * scope ↔ 저장소 source 매핑. org sweep(`org:<login>`)은 `ORG_PROVISIONED` 저장소만,
 * external sweep(`external`)은 `EXTERNAL_PUBLIC` 저장소만 훑는다 — 그래서 어떤 run의
 * stream 요약을 낼 때 다른 sweep의 stream이 섞이지 않도록 이 매핑으로 걸러낸다.
 */
const sourceForScope = (scope: string): RepositorySource =>
  scope === EXTERNAL_SCOPE ? 'EXTERNAL_PUBLIC' : 'ORG_PROVISIONED';

/**
 * lease의 `ownerId` 접두사로 트리거 종류를 판정한다(`scheduler:` / `admin:` / `cli:`).
 * ownerId 원문은 절대 밖으로 내보내지 않는다 — 분류 결과만 노출한다(#511 수용 기준).
 */
const triggerForOwnerId = (ownerId: string): CollectionSyncRunTrigger => {
  if (ownerId.startsWith('scheduler:')) return 'CRON';
  if (ownerId.startsWith('admin:')) return 'MANUAL';
  if (ownerId.startsWith('cli:')) return 'CLI';
  return 'UNKNOWN';
};

const emptyStreamSummary = (): CollectionSyncStreamSummary => ({
  readyCount: 0,
  backfillingCount: 0,
  pendingCount: 0,
  verifyingCount: 0,
  failedCount: 0,
});

/**
 * rebuild 대상 (date, githubId) 쌍 — `Contribution`(ADR-010 §4)의 입자.
 *
 * `AffectedYear`와 달리 `githubId`가 없는 항목은 대상 자체가 아니다.
 * 귀속을 모르는 기여는 누구의 것도 아니므로 사람 축 테이블에 자리가 없다.
 */
interface AffectedDay {
  date: Date;
  githubId: bigint | null;
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
   * 이 수집 저장소(`GithubRepository`)를 소유한 팀의 팀원 GitHub 계정 목록.
   * #617 단계 D 이전에는 `GithubRepository.githubRepositoryId`(전역 유일) → 별도
   * 프로비저닝 테이블(`Repository`) → `Repository.teamId` → `TeamMember` → `User`
   * 경로였다. 이제 `teamId`가 같은 `GithubRepository` 행의 컬럼이라 조회 1번으로 준다.
   *
   * 팀을 특정할 수 없으면 **`null`**을 돌려준다(저장소 행이 없거나 `teamId`가 null —
   * 후자는 인벤토리 스윕이 만든 행이거나 팀 연결 이전의 레거시 행).
   * 빈 배열(팀은 있는데 팀원이 0명)과 구분되는 값이다 — 호출자는 `null`에서만 저장소
   * 전량 REST 경로로 안전하게 되돌아간다.
   */
  async listRepositoryTeamMembers(
    githubRepositoryId: bigint,
  ): Promise<RepositoryTeamMemberAccount[] | null> {
    const owning = await this.db.githubRepository.findUnique({
      where: { githubRepositoryId },
      select: { teamId: true },
    });
    const teamId = owning?.teamId ?? null;
    if (teamId === null) return null;
    const members = await this.db.teamMember.findMany({
      where: { teamId },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { githubId: true, nickname: true } } },
    });
    return members.map((member) => ({
      githubId: member.user.githubId,
      nickname: member.user.nickname,
    }));
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
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<RecordFactsResult> {
    if (facts.length === 0) return { acceptedCount: 0, insertedCount: 0 };
    const acceptedFacts = this.onlyRegisteredFacts(facts, registeredGithubIds);
    if (acceptedFacts.length === 0) {
      return { acceptedCount: 0, insertedCount: 0 };
    }
    const { count: insertedCount } =
      await this.db.collectionCommitFact.createMany({
        data: acceptedFacts.map((fact) => ({
          repositoryId,
          sha: fact.sha,
          committedAt: fact.committedAt,
          authorGithubId: fact.authorGithubId ?? null,
          authorGithubLogin: fact.authorGithubLogin ?? null,
        })),
        skipDuplicates: true,
      });
    // 읽기가 전부 `Contribution` 으로 옮겨진 뒤라 옛 연도 집계 writer 는 제거했다.
    // 이 시점부터 사실의 원본은 fact 테이블과 `Contribution` 뿐이다.
    await this.rebuildAffectedContributions(
      repositoryId,
      acceptedFacts.map((fact) => ({
        date: asiaSeoulDate(fact.committedAt),
        githubId: fact.authorGithubId ?? null,
      })),
    );
    return { acceptedCount: acceptedFacts.length, insertedCount };
  }

  async recordPullRequestFacts(
    repositoryId: string,
    facts: readonly PullRequestFactInput[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<RecordFactsResult> {
    if (facts.length === 0) return { acceptedCount: 0, insertedCount: 0 };
    const acceptedFacts = this.onlyRegisteredFacts(facts, registeredGithubIds);
    if (acceptedFacts.length === 0) {
      return { acceptedCount: 0, insertedCount: 0 };
    }
    const { count: insertedCount } =
      await this.db.collectionPullRequestFact.createMany({
        data: acceptedFacts.map((fact) => ({
          repositoryId,
          githubPullRequestId: fact.githubPullRequestId,
          state: fact.state,
          createdAt: fact.createdAt,
          authorGithubId: fact.authorGithubId ?? null,
          authorGithubLogin: fact.authorGithubLogin ?? null,
        })),
        skipDuplicates: true,
      });
    // 읽기가 전부 `Contribution` 으로 옮겨진 뒤라 옛 연도 집계 writer 는 제거했다.
    // 이 시점부터 사실의 원본은 fact 테이블과 `Contribution` 뿐이다.
    await this.rebuildAffectedContributions(
      repositoryId,
      acceptedFacts.map((fact) => ({
        date: asiaSeoulDate(fact.createdAt),
        githubId: fact.authorGithubId ?? null,
      })),
    );
    return { acceptedCount: acceptedFacts.length, insertedCount };
  }

  async recordReleaseFacts(
    repositoryId: string,
    facts: readonly ReleaseFactInput[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): Promise<RecordFactsResult> {
    if (facts.length === 0) return { acceptedCount: 0, insertedCount: 0 };
    const acceptedFacts = this.onlyRegisteredFacts(facts, registeredGithubIds);
    if (acceptedFacts.length === 0) {
      return { acceptedCount: 0, insertedCount: 0 };
    }
    const { count: insertedCount } =
      await this.db.collectionReleaseFact.createMany({
        data: acceptedFacts.map((fact) => ({
          repositoryId,
          githubReleaseId: fact.githubReleaseId,
          publishedAt: fact.publishedAt,
          authorGithubId: fact.authorGithubId ?? null,
          authorGithubLogin: fact.authorGithubLogin ?? null,
        })),
        skipDuplicates: true,
      });
    // 읽기가 전부 `Contribution` 으로 옮겨진 뒤라 옛 연도 집계 writer 는 제거했다.
    // 이 시점부터 사실의 원본은 fact 테이블과 `Contribution` 뿐이다.
    await this.rebuildAffectedContributions(
      repositoryId,
      acceptedFacts.map((fact) => ({
        date: asiaSeoulDate(fact.publishedAt),
        githubId: fact.authorGithubId ?? null,
      })),
    );
    return { acceptedCount: acceptedFacts.length, insertedCount };
  }

  async listRegisteredGithubIds(): Promise<RegisteredGithubIdSet> {
    const users = await this.db.user.findMany({ select: { githubId: true } });
    return new Set(users.map((user) => user.githubId));
  }

  private onlyRegisteredFacts<
    T extends { readonly authorGithubId?: bigint | null },
  >(
    facts: readonly T[],
    registeredGithubIds: RegisteredGithubIdSet,
  ): readonly T[] {
    return facts.filter(
      (fact) =>
        typeof fact.authorGithubId === 'bigint' &&
        registeredGithubIds.has(fact.authorGithubId),
    );
  }

  /**
   * 조직 밖 저장소를 수집 큐에 편입한다 (ADR-010 §5·§6, ADR-009 §3).
   *
   * `OWN` 으로 연결한 저장소는 조직 인벤토리에 잡히지 않는다 — 그래서 여기서
   * 넣지 않으면 학생이 자기 저장소에서 아무리 활동해도 화면에 영영 안 나온다.
   * 현재 프로덕션의 `EXTERNAL_PUBLIC` 이 0개인 이유가 이것이다.
   *
   * **이미 있는 행의 `source` 를 덮어쓰지 않는다.** org sweep 이 같은 저장소를
   * `ORG_PROVISIONED` 로 관찰했다면 external 로 강등되면 안 된다 —
   * `githubRepositoryId` 가 단독 unique key 라 덮어쓰기가 그런 사고를 만든다.
   */
  async enrollExternalRepository(input: {
    readonly githubRepositoryId: bigint;
    readonly nameWithOwner: string;
    readonly defaultBranch: string | null;
    readonly archived: boolean;
    readonly observedAt: Date;
  }): Promise<boolean> {
    return this.runInTransaction((repo) =>
      repo.enrollExternalRepositoryInTransaction(input),
    );
  }

  private async enrollExternalRepositoryInTransaction(input: {
    readonly githubRepositoryId: bigint;
    readonly nameWithOwner: string;
    readonly defaultBranch: string | null;
    readonly archived: boolean;
    readonly observedAt: Date;
  }): Promise<boolean> {
    const currentObservation = {
      nameWithOwner: input.nameWithOwner,
      defaultBranch: input.defaultBranch,
      archived: input.archived,
      visibility: 'PUBLIC' as const,
      presence: 'PRESENT' as const,
      lastCompleteInventoryObservedAt: input.observedAt,
    };
    await this.db.githubRepository.createMany({
      data: [
        {
          githubRepositoryId: input.githubRepositoryId,
          source: 'EXTERNAL_PUBLIC',
          nextRunAt: input.observedAt,
          ...currentObservation,
        },
      ],
      skipDuplicates: true,
    });
    const updated = await this.db.githubRepository.updateMany({
      where: {
        githubRepositoryId: input.githubRepositoryId,
        source: 'EXTERNAL_PUBLIC',
      },
      data: {
        ...currentObservation,
        nextRunAt: input.observedAt,
        failureCount: 0,
      },
    });
    if (updated.count === 0) return false;
    return true;
  }

  async refreshExternalRepositoryObservation(input: {
    readonly githubRepositoryId: bigint;
    readonly nameWithOwner: string;
    readonly defaultBranch: string | null;
    readonly archived: boolean;
    readonly visibility: 'PRIVATE' | 'PUBLIC';
    readonly observedAt: Date;
  }): Promise<CollectionRepositoryRow | null> {
    await this.db.githubRepository.updateMany({
      where: {
        githubRepositoryId: input.githubRepositoryId,
        source: 'EXTERNAL_PUBLIC',
      },
      data: {
        nameWithOwner: input.nameWithOwner,
        defaultBranch: input.defaultBranch,
        archived: input.archived,
        visibility: input.visibility,
        presence: 'PRESENT',
        lastCompleteInventoryObservedAt: input.observedAt,
      },
    });
    const current = await this.db.githubRepository.findUnique({
      where: { githubRepositoryId: input.githubRepositoryId },
    });
    return current?.source === 'EXTERNAL_PUBLIC' ? current : null;
  }

  async markExternalRepositoryUnavailable(
    githubRepositoryId: bigint,
    unavailable: 'ABSENT' | 'PRIVATE',
    observedAt: Date,
  ): Promise<void> {
    await this.db.githubRepository.updateMany({
      where: { githubRepositoryId, source: 'EXTERNAL_PUBLIC' },
      data: {
        ...(unavailable === 'ABSENT'
          ? { presence: 'ABSENT' as const }
          : { visibility: 'PRIVATE' as const }),
        lastCompleteInventoryObservedAt: observedAt,
      },
    });
  }

  /**
   * 저장소 수집 실패를 기록하고 다음 시도 시각을 미룬다 (ADR-010 §6, DD1).
   *
   * 실패를 기록하는 것만으로는 부족하다 — 언제 다시 시도할지가 있어야
   * 커서를 전진시켜도 그 저장소가 버려지지 않는다. `nextRunAt` 이 그 약속이다.
   *
   * 백오프는 지수적이되 상한이 있다. 상한이 없으면 오래 실패한 저장소가
   * 사실상 영구 제외되고, 그건 우리가 없애려던 상태와 같아진다.
   */
  async recordRepositoryFailure(
    githubRepositoryId: bigint,
    now: Date,
  ): Promise<void> {
    const current = await this.db.githubRepository.findUnique({
      where: { githubRepositoryId },
      select: { failureCount: true },
    });
    const failureCount = (current?.failureCount ?? 0) + 1;
    await this.db.githubRepository.updateMany({
      where: { githubRepositoryId },
      data: {
        failureCount,
        nextRunAt: new Date(now.getTime() + backoffMs(failureCount)),
      },
    });
  }

  /**
   * 성공하면 실패 이력을 지우고 즉시 다시 대상이 되게 한다.
   *
   * `nextRunAt` 을 앞으로 밀지 않는 이유: 수집 주기는 스케줄러가 소유한다.
   * 여기서도 주기를 정하면 소유자가 둘이 되고, 둘이 어긋나면 저장소가
   * 조용히 한 사이클씩 건너뛴다. 이 칸은 **실패 백오프 전용**이다.
   */
  async recordRepositorySuccess(
    githubRepositoryId: bigint,
    now: Date,
  ): Promise<void> {
    await this.db.githubRepository.updateMany({
      where: { githubRepositoryId },
      data: { failureCount: 0, lastSuccessAt: now, nextRunAt: now },
    });
  }

  /**
   * `Contribution`(ADR-010 §4) 재계산.
   *
   * 가입자만 적재한다(§5). `githubId ∈ User` 를 만족하는 사람만 행을 만들고,
   * 이번 배치가 건드린 가입자 칸만 다시 계산한다. 기존 미가입자 행의 일괄 정리는
   * 운영 데이터 보존 결정에 따라 이 경로에서 수행하지 않는다(#682).
   *
   * **셀 단위 루프를 쓰지 않는다.** 입자가 날짜라 한 배치가 건드리는 칸이
   * (활동일 × 기여자)로 늘어나는데, 이 함수는 checkpoint 트랜잭션 안에서 돈다.
   * 칸마다 `count`×3 + `upsert` 를 하면 Prisma interactive 트랜잭션 기본
   * 5초를 넘겨 P2028 로 **fact 적재까지 함께 롤백**된다 — 활동이 많은 저장소가
   * 매 사이클 같은 자리에서 영구 실패하며, 이 변경이 없애려던 상태와 결과가 같다.
   * 그래서 칸 수와 무관하게 질의 두 문(삭제 1 + 집합 upsert 1)으로 접는다.
   */
  private async rebuildAffectedContributions(
    repositoryId: string,
    affected: readonly AffectedDay[],
  ): Promise<void> {
    const targets = new Map<string, { githubId: bigint; date: Date }>();
    for (const entry of affected) {
      // 귀속을 특정할 수 없는 기여는 애초에 대상이 아니다.
      if (entry.githubId === null) continue;
      targets.set(`${entry.githubId}:${entry.date.getTime()}`, {
        githubId: entry.githubId,
        date: entry.date,
      });
    }
    if (targets.size === 0) return;

    const rows = [...targets.values()];
    const githubIds = [...new Set(rows.map((row) => row.githubId))];
    const dates = [...new Set(rows.map((row) => row.date.getTime()))].map(
      (time) => new Date(time),
    );

    // 이번 배치가 건드린 가입자 칸만 먼저 비운다. 아래 집합 insert 가 같은 가입자
    // 경계를 통과한 결과를 다시 채우므로 신규 적재의 fail-open 이 닫힌다.
    await this.db.contribution.deleteMany({
      where: { repositoryId, githubId: { in: githubIds }, date: { in: dates } },
    });

    // fact 테이블에서 (사람, 날짜)별 합계를 만들어 한 번에 넣는다. githubIds는 이 run/import가
    // 시작할 때 고정한 가입자 snapshot을 이미 통과한 acceptedFacts에서만 왔다. 여기서 live
    // User를 다시 JOIN하면 도중의 가입/상태 변화로 fact와 Contribution의 기준이 갈라진다.
    // 세 fact 를 UNION ALL 로 모아 한 번만 그룹핑하며, 누적이 아니라 그대로 덮어쓴다.
    await this.db.$executeRaw`
      INSERT INTO "Contribution" (
        "repositoryId", "githubId", "date",
        "commitCount", "pullRequestCount", "releaseCount", "updatedAt"
      )
      SELECT
        f."repositoryId",
        f."githubId",
        f."day",
        SUM(f."commit")::int,
        SUM(f."pr")::int,
        SUM(f."release")::int,
        NOW()
      FROM (
        -- fact 시각 칸은 timestamp WITHOUT time zone 이라 저장값이 UTC 다.
        -- 바로 서울 시간대를 걸면 저장값을 서울시각으로 해석해 정반대로 움직인다.
        -- UTC 로 한 번 붙인 뒤 서울로 옮겨야 KST 자정에서 날짜가 갈린다.
        SELECT "repositoryId", "authorGithubId" AS "githubId",
               ((("committedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date) AS "day",
               1 AS "commit", 0 AS "pr", 0 AS "release"
          FROM "CollectionCommitFact"
         WHERE "repositoryId" = ${repositoryId} AND "authorGithubId" IS NOT NULL
        UNION ALL
        SELECT "repositoryId", "authorGithubId",
               ((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date),
               0, 1, 0
          FROM "CollectionPullRequestFact"
         WHERE "repositoryId" = ${repositoryId} AND "authorGithubId" IS NOT NULL
        UNION ALL
        SELECT "repositoryId", "authorGithubId",
               ((("publishedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date),
               0, 0, 1
          FROM "CollectionReleaseFact"
         WHERE "repositoryId" = ${repositoryId} AND "authorGithubId" IS NOT NULL
      ) AS f
      WHERE f."githubId" = ANY(${githubIds})
        AND f."day" = ANY(${dates.map((date) => date.toISOString().slice(0, 10))}::date[])
      GROUP BY f."repositoryId", f."githubId", f."day"
      ON CONFLICT ("repositoryId", "githubId", "date") DO UPDATE SET
        "commitCount" = EXCLUDED."commitCount",
        "pullRequestCount" = EXCLUDED."pullRequestCount",
        "releaseCount" = EXCLUDED."releaseCount",
        "updatedAt" = NOW()
    `;
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

  /**
   * #546 — stream 하나의 오류 표시만 갱신한다. frontier/status/ETag는 건드리지 않는다:
   * 실패했다고 해서 이미 확립한 safe frontier를 되돌리면 다음 run이 전체 이력을 다시
   * 훑게 되고(ADR-006 증분 계약 위반), 성공했다고 status를 올리는 것도 여기 책임이 아니다
   * (그건 checkpoint가 한다).
   *
   * 기록은 upsert다 — 신규 저장소의 첫 backfill이 실패하면 아직 stream 행 자체가 없는데,
   * 그때야말로 오류가 보여야 한다. 생성되는 행은 `PENDING`(기본값)이라 진행 집계의 의미도
   * 바뀌지 않는다(행 없는 stream도 이미 partial로 세고 있다).
   *
   * 해제는 반대로 `updateMany` + `lastErrorCode: { not: null }` 가드다 — 표시가 남아 있을
   * 때만 쓰고, 없는 행을 새로 만들지 않는다.
   */
  async markStreamErrorState(
    repositoryId: string,
    streamType: StreamFrontierInput['streamType'],
    state: { lastErrorAt: Date | null; lastErrorCode: string | null },
  ): Promise<void> {
    if (state.lastErrorCode !== null) {
      await this.upsertStreamFrontier({
        repositoryId,
        streamType,
        lastErrorAt: state.lastErrorAt,
        lastErrorCode: state.lastErrorCode,
      });
      return;
    }
    await this.db.collectionRepositoryStream.updateMany({
      where: { repositoryId, streamType, lastErrorCode: { not: null } },
      data: { lastErrorAt: null, lastErrorCode: null },
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
   * 시스템 상태 관측성 2단계 — sweep 1회 종료 시점의 결과를 append-only로 남긴다
   * (`CollectionSweepHistory`). 호출자(`CollectionSyncService.syncSweep`)가 best-effort로
   * 감싸므로 여기서는 단순 insert만 한다 — 실패해도 sweep 자체를 막지 않는 책임은
   * 호출자에 있다.
   */
  async recordSweepHistory(input: RecordSweepHistoryInput): Promise<void> {
    await this.db.collectionSweepHistory.create({
      data: {
        appId: input.appId,
        scope: input.scope,
        sweepFinishedAt: input.sweepFinishedAt,
        cycleStartedAt: input.cycleStartedAt,
        insertedCommitCount: input.insertedCommitCount,
        insertedPullRequestCount: input.insertedPullRequestCount,
        insertedReleaseCount: input.insertedReleaseCount,
        attemptedRepositoryCount: input.attemptedRepositoryCount,
        processedRepositoryCount: input.processedRepositoryCount,
        failedRepositoryCount: input.failedRepositoryCount,
        cycleCompleted: input.cycleCompleted,
        stoppedForBudget: input.stoppedForBudget,
      },
    });
  }

  /**
   * #511 — ADMIN 실행 이력 조회의 저장소 계층. 신규 테이블 없이
   * `CollectionSyncLease`(누가·어떤 runId로 마지막에 돌았는가) + `CollectionSyncCursor`
   * (사이클 시작·완료 시각) + `CollectionRepositoryStream`(진행/오류 요약)을 합성한다.
   *
   * lease가 (appId, scope)당 한 행이므로 **scope당 최근 1건**만 나온다 — 진짜 N회 이력은
   * append 되는 run 테이블이 있어야 한다(`collection-incremental.types.ts` 주석 참고).
   * 응답에는 `ownerId`·token 등 자격증명 계열 값을 절대 담지 않는다(수용 기준).
   */
  async listSyncRuns(
    now: Date,
    limit: number,
  ): Promise<CollectionSyncRunRow[]> {
    const leases = await this.db.collectionSyncLease.findMany({
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        appId: true,
        scope: true,
        ownerId: true,
        runId: true,
        expiresAt: true,
        updatedAt: true,
      },
    });
    if (leases.length === 0) return [];

    const cursors = await this.db.collectionSyncCursor.findMany({
      where: {
        OR: leases.map((lease) => ({
          appId: lease.appId,
          scope: lease.scope,
        })),
      },
      select: {
        appId: true,
        scope: true,
        cycleStartedAt: true,
        cycleCompletedAt: true,
      },
    });
    const cursorKey = (appId: bigint, scope: string): string =>
      `${appId.toString()}:${scope}`;
    const cursorByKey = new Map(
      cursors.map((cursor) => [cursorKey(cursor.appId, cursor.scope), cursor]),
    );

    const summaries = new Map<
      RepositorySource,
      { streams: CollectionSyncStreamSummary; errorCodes: string[] }
    >();
    for (const source of new Set(
      leases.map((lease) => sourceForScope(lease.scope)),
    )) {
      summaries.set(source, await this.summarizeStreams(source));
    }

    return leases.map((lease) => {
      const source = sourceForScope(lease.scope);
      const summary = summaries.get(source) ?? {
        streams: emptyStreamSummary(),
        errorCodes: [],
      };
      const cursor = cursorByKey.get(cursorKey(lease.appId, lease.scope));
      const running = lease.expiresAt.getTime() > now.getTime();
      return {
        runId: lease.runId,
        scope: lease.scope,
        trigger: triggerForOwnerId(lease.ownerId),
        status: running
          ? 'RUNNING'
          : summary.errorCodes.length > 0
            ? 'FAILED'
            : 'COMPLETED',
        startedAt: cursor?.cycleStartedAt ?? null,
        lastObservedAt: lease.updatedAt,
        cycleCompletedAt: cursor?.cycleCompletedAt ?? null,
        streams: summary.streams,
        errorCodes: summary.errorCodes,
      };
    });
  }

  private async summarizeStreams(
    source: RepositorySource,
  ): Promise<{ streams: CollectionSyncStreamSummary; errorCodes: string[] }> {
    const where = { repository: { source, presence: 'PRESENT' } } as const;
    const [statusGroups, errorGroups] = await Promise.all([
      this.db.collectionRepositoryStream.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.db.collectionRepositoryStream.groupBy({
        by: ['lastErrorCode'],
        where: { ...where, lastErrorCode: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const countFor = (status: string): number =>
      statusGroups.find((group) => group.status === status)?._count._all ?? 0;
    const failedGroups = errorGroups.filter(
      (group): group is typeof group & { lastErrorCode: string } =>
        typeof group.lastErrorCode === 'string',
    );
    return {
      streams: {
        readyCount: countFor('READY'),
        backfillingCount: countFor('BACKFILLING'),
        pendingCount: countFor('PENDING'),
        verifyingCount: countFor('VERIFYING'),
        failedCount: failedGroups.reduce(
          (total, group) => total + group._count._all,
          0,
        ),
      },
      errorCodes: failedGroups.map((group) => group.lastErrorCode).sort(),
    };
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
      where: {
        githubOrganizationId,
        source: 'ORG_PROVISIONED',
        presence: 'PRESENT',
      },
    });
  }

  /**
   * E1 — external sweep가 현재 가시성을 다시 확인할 추적 대상 전체를 읽는다.
   * ABSENT/PRIVATE도 재확인해야 다시 공개된 저장소가 자동 복구될 수 있다.
   */
  async listExternalRepositories(): Promise<CollectionRepositoryRow[]> {
    return this.db.githubRepository.findMany({
      where: { source: 'EXTERNAL_PUBLIC' },
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
