import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  CollectionAppClient,
  CollectionAppClientError,
  CollectionAppClientTokenProvider,
  CollectionCommit,
  CollectionPullRequest,
  CollectionRelease,
} from '../collection-app.client';
import { requestFingerprintKey } from '../collection-app.frontier';
import { ProviderRequestQueue } from '../collection-provider-queue';
import type { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import type {
  CollectionRepositoryRow,
  CollectionStreamType,
  RecordSweepHistoryInput,
  RegisteredGithubIdSet,
  RepositorySource,
  RepositoryTeamMemberAccount,
} from '../collection-incremental.types';
import type { SyncLeaseToken } from '../collection-sync.types';

const LEASE_MS = 10 * 60_000;
const HEARTBEAT_MS = 2 * 60_000;
const RUN_DEADLINE_MS = 45 * 60_000;

/**
 * author-scoped GraphQL commit 수집이 남기는 request fingerprint 표식. REST fingerprint와
 * 달리 조건부 요청(ETag)에 쓰이지 않는다 — GraphQL 응답에는 ETag가 없고 이 경로는 매 run
 * 팀원별 전체 이력을 다시 받는다. 어떤 요청 모양이 이 frontier 행을 세웠는지 사후에
 * 구분하기 위한 값이다.
 */
const TEAM_SCOPED_COMMIT_FINGERPRINT = 'graphql:history(author:)#first=100';

export interface CollectionSyncRuntime {
  appId: string;
  organizationLogin: string;
  // Narrow structural shape (not the `CollectionAppTokenProvider` class
  // directly) so an external-sweep runtime can carry
  // `CollectionPublicTokenProvider` here too — see
  // `CollectionAppClientTokenProvider` (`collection-app.client.ts`).
  tokens: CollectionAppClientTokenProvider;
  client: CollectionAppClient;
  queue: ProviderRequestQueue;
}

export type CollectionSyncRuntimeFactory = () =>
  CollectionSyncRuntime | Promise<CollectionSyncRuntime>;

class RunDeadlineError extends Error {}

/** stream 오류 코드의 기본값 — provider 오류 종류를 특정하지 못했을 때 쓴다. */
export const DEFAULT_STREAM_ERROR_CODE = 'STREAM_SYNC_FAILED';

/**
 * `CollectionRepositoryStream.lastErrorCode`에 남길 public-safe 분류(#546). provider client가
 * 이미 안전한 enum(`kind`)으로 오류를 좁혀 두었으므로 그것만 쓰고, 그 밖에는 고정 코드를
 * 쓴다 — 원문 메시지·토큰·URL은 어떤 경로로도 이 값에 섞이지 않는다.
 */
const streamErrorCode = (error: unknown): string =>
  error instanceof CollectionAppClientError
    ? `PROVIDER_${error.kind}`
    : DEFAULT_STREAM_ERROR_CODE;

/** `SKIPPED`는 저장소 1건 run(`runRepository`)이 그 저장소를 수집 대상으로 보지 않았다는 뜻이다. */
export type CollectionSyncRunStatus =
  'SKIPPED' | 'SKIPPED_LEASE_HELD' | 'COMPLETED' | 'FAILED';

export interface CollectionSyncRunResult {
  runId: string;
  status: CollectionSyncRunStatus;
  inventoryComplete: boolean | null;
  processedRepositoryCount: number;
  cycleCompleted: boolean;
  stoppedForBudget: boolean;
  /**
   * #511 — 이번 run이 새로 적재한 fact 수(commit/PR/release/issue 합). 중복 fact는 세지 않는다
   * (`createMany`+`skipDuplicates`가 반환하는 실제 삽입 수만 누적). 트리거 표면이 성공
   * 로그에 "신규 수집 건수"를 남기기 위한 유일한 출처다.
   */
  insertedFactCount: number;
}

/** 저장소를 하나도 처리하지 않은 run의 결과. */
const idleRunResult = (
  runId: string,
  status: CollectionSyncRunStatus,
): CollectionSyncRunResult => ({
  runId,
  status,
  inventoryComplete: null,
  processedRepositoryCount: 0,
  cycleCompleted: false,
  stoppedForBudget: false,
  insertedFactCount: 0,
});

/**
 * 수집 한 번이 stream별로 새로 넣은 수. 순회와 연결 즉시 수집이 같은 칸으로 이력을 남긴다
 * (`CollectionSweepHistory`, #1133).
 */
function insertedCounter() {
  const counts = { commit: 0, pullRequest: 0, release: 0, issue: 0 };
  const add = (streamType: CollectionStreamType, insertedCount: number) => {
    switch (streamType) {
      case 'COMMIT':
        counts.commit += insertedCount;
        break;
      case 'PULL_REQUEST':
        counts.pullRequest += insertedCount;
        break;
      case 'RELEASE':
        counts.release += insertedCount;
        break;
      case 'ISSUE':
        counts.issue += insertedCount;
        break;
    }
  };
  return { counts, add };
}

/** `syncOne`이 저장소 하나를 수집한 결과. */
type RepositorySyncOutcome =
  | { readonly kind: 'PROCESSED' }
  | { readonly kind: 'FAILED'; readonly errorName: string }
  | { readonly kind: 'STOPPED_FOR_BUDGET' }
  /** 수집 직전에 다시 읽어 보니 더 이상 수집 대상이 아니다(연결이 풀림). */
  | { readonly kind: 'SKIPPED' };

type SyncRepository = Pick<
  CollectionIncrementalRepository,
  | 'runInTransaction'
  | 'getStreamFrontier'
  | 'upsertStreamFrontier'
  | 'markStreamOutcome'
  | 'recordCommitFacts'
  | 'recordPullRequestFacts'
  | 'recordReleaseFacts'
  | 'recordIssueFacts'
  | 'listRegisteredGithubIds'
  | 'recordRepositoryObservation'
  | 'refreshExternalRepositoryObservation'
  | 'markExternalRepositoryUnavailable'
  | 'recordRepositoryFailure'
  | 'recordRepositorySuccess'
  | 'markAbsentRepositories'
  | 'listPresentRepositories'
  | 'listExternalRepositories'
  | 'listRepositoryTeamMembers'
  | 'findOutsiderCountingWindow'
  | 'countTeamCommitsBetween'
  | 'saveOutsiderContribution'
  | 'getSyncCursor'
  | 'upsertSyncCursor'
  | 'recordSweepHistory'
  | 'findRepositoryByLogicalKey'
  | 'acquireSyncLease'
  | 'heartbeatSyncLease'
  | 'releaseSyncLease'
  | 'assertSyncLeaseValid'
>;

const compareBigint = (a: bigint, b: bigint): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * PR stream에는 SHA frontier가 없으므로 `frontierSha`를 팀원 집합의 로컬 frontier로 쓴다.
 * digest는 별도 control field에 팀원 id 원문을 남기지 않으면서 같은 집합에 같은 표식을 만든다.
 * version prefix가 없는 기존 READY 행(`frontierSha = null`)은 배포 후 한 번 repair backfill하고,
 * 그 뒤 팀원 집합이 그대로인 sweep은 다시 증분 경로를 탄다.
 */
const pullRequestTeamMembershipFrontier = (
  members: readonly RepositoryTeamMemberAccount[],
): string => {
  const memberIds = members
    .map((member) => member.githubId)
    .sort(compareBigint)
    .map(String)
    .join('\n');
  const digest = createHash('sha256').update(memberIds).digest('hex');
  return `team-members:v1:${digest}`;
};

const splitNameWithOwner = (nameWithOwner: string): [string, string] => {
  const index = nameWithOwner.indexOf('/');
  if (index < 0) {
    throw new Error(
      `invalid collection repository nameWithOwner: ${nameWithOwner}`,
    );
  }
  return [nameWithOwner.slice(0, index), nameWithOwner.slice(index + 1)];
};

/** org sweep의 scope 관례 — external sweep의 고정 `"external"`과 서로소다. */
const orgScope = (organizationLogin: string): string =>
  `org:${organizationLogin}`;
const EXTERNAL_SCOPE = 'external';

/**
 * ADR-009 §4 — 팀원 GitHub 계정 id 집합. `User.githubId`가 `BigInt @unique`(non-null)라
 * 이 집합에는 null이 절대 들어오지 않는다.
 */
const teamMemberGithubIds = (
  members: readonly RepositoryTeamMemberAccount[],
): ReadonlySet<bigint> => new Set(members.map((member) => member.githubId));

/**
 * ADR-009 «PR·릴리스는 적재 시 거른다» — 작성자가 이 저장소를 소유한 팀의 팀원인가.
 *
 * `authorGithubId`가 `null`이면 **거른다.** 삭제·이관된 GitHub 계정이나 provider가
 * author를 못 붙인 항목이 여기 해당하는데, 통과시키면 "누구인지 모르는 사람의 활동"이
 * fact에 남는다. 팀원임을 증명하지 못한 것은 팀원이 아닌 쪽으로 판정하는 fail-closed가
 * 이 ADR이 막으려는 실수(제3자 적재)를 되돌릴 수 없게 만들지 않는 유일한 방향이다.
 */
const isTeamMemberAuthor = (
  authorGithubId: string | null,
  memberIds: ReadonlySet<bigint>,
): boolean => authorGithubId !== null && memberIds.has(BigInt(authorGithubId));

/** GitHub App 봇 계정(`dependabot[bot]` 등) — REST는 봇에게도 `login` 끝에 `[bot]`을 붙인다. */
const isBotLogin = (login: string | null): boolean =>
  login !== null && login.toLowerCase().endsWith('[bot]');

/**
 * 「팀원이 아닌 사람의 기여」(#1133)로 셀 PR·Issue 작성자인가 — GitHub 계정이 확인됐고, 지금 팀원도
 * 봇도 아니다. 작성자를 알 수 없는 항목은 팀원의 것일 수도 있어 세지 않는다. (Commit은 작성자를 받지
 * 않고 ADR-009 `전체 − 팀원합`으로 센다.)
 */
const isOutsiderAuthor = (
  item: {
    readonly authorGithubId: string | null;
    readonly authorLogin: string | null;
  },
  memberIds: ReadonlySet<bigint>,
): boolean =>
  item.authorGithubId !== null &&
  !isTeamMemberAuthor(item.authorGithubId, memberIds) &&
  !isBotLogin(item.authorLogin);

/** GitHub가 생기기 전 시각(프로그램 시작일 기본값 0001-01-01 등)은 REST `since`에 넣지 않는다. */
const GITHUB_EPOCH_MS = Date.UTC(2008, 0, 1);

/** REST `since`·`until` 형식(`YYYY-MM-DDTHH:MM:SSZ`) — 밀리초를 떼어 문서 형식 그대로 보낸다. */
const githubTimestamp = (at: Date): string =>
  at.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * 수집 대상 규칙 — 신청에 연결된 저장소이거나, 팀·프로그램 이력이 전혀 없는 독립 저장소다.
 * `listExternalRepositories`의 SQL 조건과 한 벌이다. 연결이 풀려 이전 팀·프로그램 이력만 남은
 * 저장소는 그 이력을 보존만 하고 새 fact는 받지 않는다 — 계속 수집하면 팀이 떠난 저장소의 활동이
 * 그 이력을 타고 프로그램 실적에 계속 쌓인다. 인벤토리·presence 관찰은 이 규칙과 무관하다.
 */
const isCollectionTarget = (repository: CollectionRepositoryRow): boolean =>
  repository.applicationId != null ||
  (repository.programId == null && repository.teamId == null);

interface SweepInventory {
  readonly complete: boolean;
  readonly repositories: readonly CollectionRepositoryRow[];
}

/**
 * ADR-006 조직 전체 누적·증분 수집의 provider traversal orchestration(public-admin-exposure
 * todo 10). `CollectionReconciliationService`와 같은 lease/heartbeat/deadline 골격을 새 저장
 * 계층(`CollectionSyncLease`/`CollectionSyncCursor`/incremental facts·stream)에 대해 재구현한다.
 *
 * 매 run:
 *   1) 전체 inventory 목록을 시도한다. 성공(complete)하면 visibility/presence 관찰을 lease-fenced
 *      독립 트랜잭션 하나로 반영한다(활동 스트림 동기화와 완전히 분리 — 이후 어떤 stream 실패도
 *      이 관찰을 되돌리지 못한다). 실패(partial)하면 이 run은 관찰을 전혀 건드리지 않고 이미 알려진
 *      PRESENT 저장소로 stream sync만 계속한다.
 *   2) 저장소를 githubRepositoryId 오름차순으로 정렬하고, durable cursor(`CollectionSyncCursor`)
 *      기준으로 이어간다 — 이번 run에서 이미 지난 저장소는 절대 다시 repo 1부터 재시작하지 않는다.
 *   3) 저장소별로 commit/PR/release/issue 네 stream을 순서대로 동기화한다. 새 stream row(및 backfill이
 *      만든 VERIFYING 자리표시자)는 실제 provider traversal이 안전한 frontier를 확립했을 때만
 *      READY로 승격한다. 이미 READY인 스트림은 조건부 poll(conditional GET/probe)만 수행하고,
 *      바뀐 것이 없으면 전체 이력 호출을 하지 않는다.
 *   4) provider 요청은 하나의 fair serial queue(`ProviderRequestQueue`)를 통과한다 — 250ms 최소
 *      페이싱, 남은 rate limit이 `max(100, limit의 20%)` 이하로 떨어지면 이번 run을 안전하게
 *      정지하고 durable cursor에서 다음 run이 이어간다.
 */
@Injectable()
export class CollectionSyncService {
  private readonly logger = new Logger(CollectionSyncService.name);

  constructor(
    private readonly incrementalRepository: SyncRepository,
    private readonly runtimeFactory: CollectionSyncRuntimeFactory,
    private readonly resolveGithubOrganizationId: () => Promise<bigint>,
    private readonly now: () => Date = () => new Date(),
    private readonly createRunId: () => string = randomUUID,
    // E1 — external sweep runtime (`CollectionPublicTokenProvider` service
    // account PAT, per plan §4.2), provisioned separately from the org
    // installation runtime above and with its own `ProviderRequestQueue`
    // (independent rate-limit budget). `collection.module.ts` wires this in
    // for the DI-managed service; the CLI entry points under `cli/` still
    // leave it undefined, since they have no external-sweep use case yet —
    // `runExternal` fails closed with a clear error rather than silently
    // reusing the org installation-token client (which cannot read repos
    // outside the installation's scope).
    private readonly externalRuntimeFactory?: CollectionSyncRuntimeFactory,
  ) {}

  /**
   * `runId`는 트리거 표면이 만들어 넘길 수 있다(#546). 넘기지 않으면 예전처럼 이 서비스가
   * 만든다 — 관리자 수동 트리거가 202로 돌려준 runId와 lease에 박히는 내부 runId가 서로
   * 달라 완료·실패를 조회할 수 없던 문제를 이 한 인자로 닫는다.
   */
  async run(
    ownerId: string,
    runId?: string,
    registeredGithubIds?: RegisteredGithubIdSet,
  ): Promise<CollectionSyncRunResult> {
    const runtime = await this.runtimeFactory();
    const githubOrganizationId = await this.resolveGithubOrganizationId();
    return this.runSweep({
      source: 'ORG_PROVISIONED',
      scope: orgScope(runtime.organizationLogin),
      appId: BigInt(runtime.appId),
      ownerId,
      runId,
      registeredGithubIds,
      runtime,
      discoverInventory: (lease, deadline) =>
        this.syncOrgInventory(runtime, lease, githubOrganizationId, deadline),
    });
  }

  /**
   * E1 — external(학생 등록 public repo) sweep. org sweep과 stage ②~⑨(metadata/commit/
   * PR/release/cursor/fact-load/aggregate)는 완전히 공유하되, discovery만 다르다: org
   * installation listing 대신 이미 `EXTERNAL_PUBLIC` source로 저장된 행을 읽는다(자동
   * GraphQL 발견은 이 메서드의 범위가 아니다 — 별도 과제). 자신만의 `scope`(`"external"`)로
   * lease/cursor를 갖기 때문에 org sweep의 45분 run budget이나 lease를 절대 소비하지
   * 않는다(GR-9).
   */
  async runExternal(
    ownerId: string,
    runId?: string,
  ): Promise<CollectionSyncRunResult> {
    const runtime = await this.externalRuntime();
    return this.runSweep({
      source: 'EXTERNAL_PUBLIC',
      scope: EXTERNAL_SCOPE,
      appId: BigInt(runtime.appId),
      ownerId,
      runId,
      runtime,
      discoverInventory: (lease, deadline) =>
        this.syncExternalInventory(runtime, lease, deadline),
    });
  }

  /**
   * 방금 연결한 저장소 하나를 매시 sweep을 기다리지 않고 바로 수집한다(#1133). 그 저장소의
   * sweep과 같은 scope lease 아래에서 sweep 루프와 같은 `syncOne`을 돌리므로 두 경로가 같은
   * 저장소를 동시에 쓰지 않는다. sweep cursor는 건드리지 않는다 — 다음 sweep은 평소대로 이
   * 저장소까지 다시 훑는다. 이력은 `REPOSITORY_LINK` 한 행으로 남긴다 — 남기지 않으면 이 수집이
   * 넣은 기록이 「최근 수집 활동」과 외부 저장소 누적 합계에서 빠진다(다음 sweep은 새것이 없다).
   *
   * 수집 대상이 아니거나, 사라졌거나, 기본 브랜치를 아직 모르거나(조직 저장소는 sweep 인벤토리가
   * 채운다), 조직 밖인데 공개가 아니면 provider를 부르지 않고 `SKIPPED`다. lease를 sweep이
   * 쥐고 있으면 `SKIPPED_LEASE_HELD`다 — 도는 중이거나 다음 sweep이 이 저장소를 수집한다.
   *
   * ponytail: 이 run이 scope lease를 쥔 사이에 매시 cron이 오면 그 scope는 한 tick을 건너뛴다.
   * 트리거가 프로세스 안에 있어 저장과 실행 사이에 재시작하면 수집은 매시 sweep으로 밀린다.
   * 둘 다 문제가 되면 연결 이벤트를 durable 큐로 옮긴다.
   */
  async runRepository(
    ownerId: string,
    githubRepositoryId: bigint,
    runId: string = this.createRunId(),
  ): Promise<CollectionSyncRunResult> {
    const repository =
      await this.incrementalRepository.findRepositoryByLogicalKey(
        githubRepositoryId,
      );
    if (
      repository === null ||
      !isCollectionTarget(repository) ||
      repository.presence !== 'PRESENT' ||
      repository.defaultBranch === null ||
      (repository.source === 'EXTERNAL_PUBLIC' &&
        repository.visibility !== 'PUBLIC')
    ) {
      return idleRunResult(runId, 'SKIPPED');
    }
    const external = repository.source === 'EXTERNAL_PUBLIC';
    const runtime = external
      ? await this.externalRuntime()
      : await this.runtimeFactory();
    const key = {
      appId: BigInt(runtime.appId),
      scope: external ? EXTERNAL_SCOPE : orgScope(runtime.organizationLogin),
    };
    return this.withSyncLease(key, ownerId, runId, async (lease) => {
      const deadline = this.now().getTime() + RUN_DEADLINE_MS;
      const identitySnapshot =
        await this.incrementalRepository.listRegisteredGithubIds();
      let insertedFactCount = 0;
      const inserted = insertedCounter();
      // sweep 루프와 같은 rate budget 정지 조건이다.
      const attempted = !runtime.queue.shouldStop();
      const outcome: RepositorySyncOutcome = attempted
        ? await this.syncOne(
            runtime,
            lease,
            repository,
            identitySnapshot,
            deadline,
            runId,
            (streamType, insertedCount) => {
              insertedFactCount += insertedCount;
              inserted.add(streamType, insertedCount);
            },
          )
        : { kind: 'STOPPED_FOR_BUDGET' };
      await this.incrementalRepository.releaseSyncLease(lease, this.now());
      // 수집 직전에 다시 읽어 보니 연결이 풀려 있었다면(`SKIPPED`) 아무것도 모으지 않았다 —
      // 한 줄을 남기면 화면이 「연결 즉시 수집」(성공)으로 읽는다. 시작 전에 건너뛸 때처럼 남기지 않는다.
      if (outcome.kind !== 'SKIPPED')
        await this.recordSweepHistoryBestEffort({
          appId: key.appId,
          scope: key.scope,
          kind: 'REPOSITORY_LINK',
          sweepFinishedAt: this.now(),
          cycleStartedAt: null,
          insertedCommitCount: inserted.counts.commit,
          insertedPullRequestCount: inserted.counts.pullRequest,
          insertedReleaseCount: inserted.counts.release,
          insertedIssueCount: inserted.counts.issue,
          attemptedRepositoryCount: attempted ? 1 : 0,
          processedRepositoryCount: outcome.kind === 'PROCESSED' ? 1 : 0,
          failedRepositoryCount: outcome.kind === 'FAILED' ? 1 : 0,
          cycleCompleted: false,
          stoppedForBudget: outcome.kind === 'STOPPED_FOR_BUDGET',
        });
      return {
        ...idleRunResult(runId, 'COMPLETED'),
        processedRepositoryCount: outcome.kind === 'PROCESSED' ? 1 : 0,
        stoppedForBudget: outcome.kind === 'STOPPED_FOR_BUDGET',
        insertedFactCount,
      };
    });
  }

  private externalRuntime():
    CollectionSyncRuntime | Promise<CollectionSyncRuntime> {
    if (!this.externalRuntimeFactory) {
      throw new Error(
        'collection sync: external runtime not configured (runExternal requires an externalRuntimeFactory)',
      );
    }
    return this.externalRuntimeFactory();
  }

  private async runSweep(params: {
    source: RepositorySource;
    scope: string;
    appId: bigint;
    ownerId: string;
    runId?: string;
    registeredGithubIds?: RegisteredGithubIdSet;
    runtime: CollectionSyncRuntime;
    discoverInventory: (
      lease: SyncLeaseToken,
      deadline: number,
    ) => Promise<SweepInventory>;
  }): Promise<CollectionSyncRunResult> {
    // `source` isn't read directly here — it's already baked into the
    // caller-provided `discoverInventory` closure (`syncOrgInventory` /
    // `syncExternalInventory`). It's still a required field on `params` so
    // every call site stays explicit about which sweep it's running.
    const {
      scope,
      appId,
      ownerId,
      runtime,
      discoverInventory,
      registeredGithubIds,
    } = params;
    const key = { appId, scope };
    const runId = params.runId ?? this.createRunId();
    return this.withSyncLease(key, ownerId, runId, (lease) =>
      this.syncSweep(
        runtime,
        lease,
        key,
        runId,
        discoverInventory,
        registeredGithubIds,
      ),
    );
  }

  /** scope lease를 잡고 heartbeat 안에서 `work`를 돌린다. 못 잡으면 `SKIPPED_LEASE_HELD`다. */
  private async withSyncLease(
    key: { appId: bigint; scope: string },
    ownerId: string,
    runId: string,
    work: (lease: SyncLeaseToken) => Promise<CollectionSyncRunResult>,
  ): Promise<CollectionSyncRunResult> {
    const acquiredAt = this.now();
    const lease = await this.incrementalRepository.acquireSyncLease({
      ...key,
      ownerId,
      runId,
      now: acquiredAt,
      expiresAt: new Date(acquiredAt.getTime() + LEASE_MS),
    });
    if (!lease) return idleRunResult(runId, 'SKIPPED_LEASE_HELD');

    try {
      return await this.withHeartbeat(lease, () => work(lease));
    } catch (error) {
      this.logger.error({
        event: 'collection.sync.failed',
        runId,
        scope: key.scope,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      await this.incrementalRepository
        .releaseSyncLease(lease, this.now())
        .catch(() => undefined);
      return idleRunResult(runId, 'FAILED');
    }
  }

  private async syncSweep(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    key: { appId: bigint; scope: string },
    runId: string,
    discoverInventory: (
      lease: SyncLeaseToken,
      deadline: number,
    ) => Promise<SweepInventory>,
    registeredGithubIds?: RegisteredGithubIdSet,
  ): Promise<CollectionSyncRunResult> {
    const deadline = this.now().getTime() + RUN_DEADLINE_MS;

    // D9 — identity는 Customer/Supplier 경계다. 저장소나 fact마다 다시 묻지 않고
    // run 시작 시 한 번 고정한다. 조회 실패는 inventory/fact write 전에 전파되어
    // 개인 데이터 적재보다 수집 지연 쪽으로 fail-closed 한다.
    const identitySnapshot =
      registeredGithubIds ??
      (await this.incrementalRepository.listRegisteredGithubIds());

    const inventory = await discoverInventory(lease, deadline);

    const cursor = await this.incrementalRepository.getSyncCursor(
      key.appId,
      key.scope,
    );
    const startAfter =
      cursor && cursor.cycleCompletedAt === null
        ? cursor.lastGithubRepositoryId
        : null;

    let cycleStartedAt = cursor?.cycleStartedAt ?? null;
    if (startAfter === null) {
      // Fresh cycle (no cursor yet, or the previous cycle already
      // wrapped around) — stamp the start once, up front.
      cycleStartedAt = this.now();
      const freshCycleStartedAt = cycleStartedAt;
      await this.incrementalRepository.runInTransaction(async (repo) => {
        await repo.assertSyncLeaseValid(lease, this.now());
        await repo.upsertSyncCursor({
          appId: key.appId,
          scope: key.scope,
          cycleStartedAt: freshCycleStartedAt,
          cycleCompletedAt: null,
        });
      });
    }

    const sweepStartedAt = this.now();
    const ordered = [...inventory.repositories]
      .filter(isCollectionTarget)
      .filter(
        (repository) =>
          startAfter === null ||
          compareBigint(repository.githubRepositoryId, startAfter) > 0,
      )
      // 백오프가 아직 안 지난 **실패 저장소**는 이번 사이클에서 건너뛴다(ADR-010 §6).
      // 이게 없으면 `nextRunAt` 은 기록만 되고 스케줄을 바꾸지 않아,
      // 연속 실패 저장소가 매 사이클 같은 비용을 다시 쓴다.
      //
      // `failureCount > 0` 인 행에만 건다. 한 번도 실패하지 않은 행의 `nextRunAt` 은
      // **DB 기본값**(`now()`)이라 이 서비스에 주입된 시계와 다른 원본에서 온다 —
      // 두 시간 원본을 비교하면 시계가 과거로 고정된 경로에서 모든 저장소가
      // 통째로 걸러진다. 백오프 값은 실패 기록이 같은 시계로 쓰므로 비교가 성립한다.
      .filter(
        (repository) =>
          (repository.failureCount ?? 0) === 0 ||
          repository.nextRunAt === null ||
          repository.nextRunAt === undefined ||
          repository.nextRunAt <= sweepStartedAt,
      )
      .sort((a, b) =>
        compareBigint(a.githubRepositoryId, b.githubRepositoryId),
      );

    let processedRepositoryCount = 0;
    let insertedFactCount = 0;
    const inserted = insertedCounter();
    let stoppedForBudget = false;
    let lastError: string | null = null;
    let failedRepositoryCount = 0;
    let attemptedRepositoryCount = 0;

    for (const repository of ordered) {
      if (this.now().getTime() >= deadline) {
        stoppedForBudget = true;
        break;
      }
      if (runtime.queue.shouldStop()) {
        stoppedForBudget = true;
        break;
      }
      attemptedRepositoryCount += 1;
      const outcome = await this.syncOne(
        runtime,
        lease,
        repository,
        identitySnapshot,
        deadline,
        runId,
        (streamType, insertedCount) => {
          insertedFactCount += insertedCount;
          inserted.add(streamType, insertedCount);
        },
      );
      if (outcome.kind === 'STOPPED_FOR_BUDGET') {
        stoppedForBudget = true;
        break;
      }
      if (outcome.kind === 'PROCESSED') {
        // 성공한 저장소만 센다. 실패해도 커서는 아래에서 전진하지만
        // "처리했다"고 말하지는 않는다.
        processedRepositoryCount += 1;
      } else if (outcome.kind === 'FAILED') {
        lastError = outcome.errorName;
        failedRepositoryCount += 1;
      }
      // 실패해도 커서를 전진시킨다(DD1).
      //
      // 예전에는 실패에서 break 해 커서를 세웠다. 그러면 영구 실패 저장소 하나가
      // 뒤의 모든 저장소를 굶긴다 — 다음 run 도 같은 자리에서 멈추기 때문이다.
      //
      // 단순히 전진시키기만 하면 반대 문제가 생긴다. 사이클이 닫혀야 커서가
      // 리셋되는데 실패가 있으면 안 닫히던 시절에는, 전진 = 그 저장소를
      // 영영 버리는 것이었다. 그래서 둘을 같이 바꾼다:
      //   (1) `syncOne` 이 실패를 `failureCount` + `nextRunAt` 백오프로 기록해
      //       되돌아올 약속을 남기고
      //   (2) 아래 `cycleCompleted` 에서 실패를 사이클 완료의 방해로 보지 않는다.
      // 실패 저장소는 백오프가 지나면 다음 사이클에서 다시 시도된다.
      await this.incrementalRepository.runInTransaction(async (repo) => {
        await repo.assertSyncLeaseValid(lease, this.now());
        await repo.upsertSyncCursor({
          appId: key.appId,
          scope: key.scope,
          lastGithubRepositoryId: repository.githubRepositoryId,
        });
      });
    }

    if (failedRepositoryCount > 0) {
      // 사이클 단위 요약. 저장소별 실패는 각 stream 의 `lastErrorCode` 와
      // `failureCount` 에 남고, 여기서는 "이번 스윕에서 몇 개가 실패했는가" 만
      // 남긴다 — 저장소 식별자를 담지 않으므로 공개 로그 경계를 넘지 않는다.
      this.logger.warn({
        event: 'collection.sync.repositories_failed',
        runId,
        failedRepositoryCount,
        attemptedRepositoryCount,
        totalRepositoryCount: ordered.length,
        lastErrorName: lastError,
      });
    }

    // 사이클 완료 판정에서 실패를 빼는 것이 이 변경의 핵심 절반이다.
    //
    // 실패가 사이클을 막으면 커서가 리셋되지 않고, 그러면 커서를 전진시킨
    // 저장소로 되돌아갈 길이 사라진다. 실패는 `failureCount`·`nextRunAt` 과
    // stream 의 `lastErrorCode` 가 이미 기록하므로, 사이클은 "전부 시도했는가"
    // 만 본다. 예산 소진으로 중간에 멈춘 것은 여전히 미완이다.
    const cycleCompleted =
      !stoppedForBudget && attemptedRepositoryCount === ordered.length;
    if (cycleCompleted) {
      await this.incrementalRepository.runInTransaction(async (repo) => {
        await repo.assertSyncLeaseValid(lease, this.now());
        await repo.upsertSyncCursor({
          appId: key.appId,
          scope: key.scope,
          lastGithubRepositoryId: null,
          cycleCompletedAt: this.now(),
        });
      });
    }

    await this.incrementalRepository.releaseSyncLease(lease, this.now());

    await this.recordSweepHistoryBestEffort({
      appId: key.appId,
      scope: key.scope,
      kind: 'SWEEP',
      sweepFinishedAt: this.now(),
      cycleStartedAt,
      insertedCommitCount: inserted.counts.commit,
      insertedPullRequestCount: inserted.counts.pullRequest,
      insertedReleaseCount: inserted.counts.release,
      insertedIssueCount: inserted.counts.issue,
      attemptedRepositoryCount,
      processedRepositoryCount,
      failedRepositoryCount,
      cycleCompleted,
      stoppedForBudget,
    });

    return {
      runId,
      status: 'COMPLETED',
      inventoryComplete: inventory.complete,
      processedRepositoryCount,
      cycleCompleted,
      stoppedForBudget,
      insertedFactCount,
    };
  }

  /**
   * 시스템 상태 관측성 2단계 — sweep-history 기록은 bookkeeping이라 실패해도 sweep
   * 자체(원래 결과)를 막지 않는다. `writeStreamOutcome`과 같은 best-effort 원칙이다.
   */
  private async recordSweepHistoryBestEffort(
    input: RecordSweepHistoryInput,
  ): Promise<void> {
    try {
      await this.incrementalRepository.recordSweepHistory(input);
    } catch (error) {
      this.logger.warn({
        event: 'collection.sync.sweep_history_write_failed',
        scope: input.scope,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  /**
   * E1 org-side discovery — installation listing 성공 시 `source: 'ORG_PROVISIONED'`로
   * 관찰을 기록하고, 이번에 관찰되지 않은 기존 ORG_PROVISIONED 저장소를 ABSENT로 표시한다
   * (GR-6: `markAbsentRepositories`가 ORG_PROVISIONED만 스윕하므로 external 저장소는 이
   * 경로의 영향을 받지 않는다). 실패(partial) 시에도 같은 이유로 ORG_PROVISIONED만
   * 되짚는다.
   */
  private async syncOrgInventory(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    githubOrganizationId: bigint,
    deadline: number,
  ): Promise<SweepInventory> {
    let listed;
    try {
      listed = await this.beforeDeadline(
        runtime.client.listInstallationRepositories(),
        deadline,
      );
    } catch {
      // Partial inventory — never mark anything missing, never touch
      // visibility/presence this run. Stream sync still proceeds against
      // whatever was already observed PRESENT.
      const known =
        await this.incrementalRepository.listPresentRepositories(
          githubOrganizationId,
        );
      return { complete: false, repositories: known };
    }

    const observedAt = this.now();
    const repositories = await this.incrementalRepository.runInTransaction(
      async (repo) => {
        await repo.assertSyncLeaseValid(lease, observedAt);
        const upserted: CollectionRepositoryRow[] = [];
        for (const item of listed) {
          upserted.push(
            await repo.recordRepositoryObservation({
              githubOrganizationId,
              githubRepositoryId: BigInt(item.id),
              nameWithOwner: item.fullName,
              defaultBranch: item.defaultBranch,
              archived: item.archived,
              visibility: item.private ? 'PRIVATE' : 'PUBLIC',
              presence: 'PRESENT',
              source: 'ORG_PROVISIONED',
              observedAt,
            }),
          );
        }
        await repo.markAbsentRepositories(
          githubOrganizationId,
          upserted.map((row) => row.githubRepositoryId),
          observedAt,
        );
        return upserted;
      },
    );

    return { complete: true, repositories };
  }

  /**
   * E1 external-side inventory — 등록된 각 저장소를 공개 자격으로 다시 조회한다.
   * 404/비공개는 그 저장소에 대한 완전 관찰이므로 즉시 공개 상태를 회수하고,
   * rate limit·5xx 같은 부분 실패는 기존 관찰을 유지한다(ADR-006 fail-closed).
   */
  private async syncExternalInventory(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    deadline: number,
  ): Promise<SweepInventory> {
    const tracked = await this.incrementalRepository.listExternalRepositories();
    const repositories: CollectionRepositoryRow[] = [];
    let complete = true;

    for (let index = 0; index < tracked.length; index += 1) {
      const current = tracked[index];
      if (current === undefined) continue;
      if (runtime.queue.shouldStop()) {
        complete = false;
        repositories.push(
          ...tracked
            .slice(index)
            .filter(
              (repository) =>
                repository.visibility === 'PUBLIC' &&
                repository.presence === 'PRESENT',
            ),
        );
        break;
      }

      const [owner, name] = splitNameWithOwner(current.nameWithOwner);
      const observedAt = this.now();
      let metadata;
      try {
        metadata = await this.beforeDeadline(
          runtime.client.getRepository(owner, name),
          deadline,
        );
      } catch (error) {
        if (error instanceof RunDeadlineError) throw error;
        if (
          error instanceof CollectionAppClientError &&
          (error.kind === 'NOT_FOUND' || error.kind === 'PERMISSION')
        ) {
          await this.incrementalRepository.runInTransaction(async (repo) => {
            await repo.assertSyncLeaseValid(lease, observedAt);
            await repo.markExternalRepositoryUnavailable(
              current.githubRepositoryId,
              error.kind === 'NOT_FOUND' ? 'ABSENT' : 'PRIVATE',
              observedAt,
            );
          });
          continue;
        }
        complete = false;
        // 부분 관찰은 마지막 complete visibility를 덮어쓰지 않는다. 다만 현재
        // 공개 여부를 다시 증명하지 못한 run에서는 stream을 실행하지 않아,
        // 비공개 전환 직후의 새 fact를 stale PUBLIC 상태에 더하지 않는다.
        continue;
      }

      if (BigInt(metadata.id) !== current.githubRepositoryId) {
        await this.incrementalRepository.runInTransaction(async (repo) => {
          await repo.assertSyncLeaseValid(lease, observedAt);
          await repo.markExternalRepositoryUnavailable(
            current.githubRepositoryId,
            'ABSENT',
            observedAt,
          );
        });
        continue;
      }

      const refreshed = await this.incrementalRepository.runInTransaction(
        async (repo) => {
          await repo.assertSyncLeaseValid(lease, observedAt);
          return repo.refreshExternalRepositoryObservation({
            githubRepositoryId: current.githubRepositoryId,
            nameWithOwner: metadata.fullName,
            defaultBranch: metadata.defaultBranch,
            archived: metadata.archived,
            visibility: metadata.private ? 'PRIVATE' : 'PUBLIC',
            observedAt,
          });
        },
      );
      if (refreshed?.visibility === 'PUBLIC') {
        repositories.push(refreshed);
      }
    }

    return { complete, repositories };
  }

  /**
   * 저장소 하나를 수집하고 그 결과를 저장소 행에 남긴다. 저장소 단위 실패는 여기서 백오프로
   * 기록하고 삼킨다. lease 상실처럼 기록 자체가 실패하면 그대로 던져 run을 끝낸다.
   */
  private async syncOne(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    registeredGithubIds: RegisteredGithubIdSet,
    deadline: number,
    runId: string,
    onStreamInserted: (
      streamType: CollectionStreamType,
      insertedCount: number,
    ) => void,
  ): Promise<RepositorySyncOutcome> {
    // sweep은 시작할 때 읽은 목록을 몇 분에 걸쳐 돈다. 그사이 팀이 저장소를 바꿨으면 떼어 낸
    // 저장소에 새 fact를 쓰지 않도록 수집 직전에 행을 다시 읽는다.
    // ponytail: 이 확인과 적재 사이(저장소 하나를 수집하는 몇 초)에 바뀐 연결은 그 run의 fact가
    // 옛 저장소에 남는다. 문제가 되면 checkpoint 트랜잭션에서 저장소 행을 잠그고 다시 확인한다.
    const current = await this.incrementalRepository.findRepositoryByLogicalKey(
      repository.githubRepositoryId,
    );
    if (current !== null && !isCollectionTarget(current)) {
      return { kind: 'SKIPPED' };
    }
    try {
      await this.syncRepository(
        runtime,
        lease,
        repository,
        registeredGithubIds,
        deadline,
        onStreamInserted,
      );
      // 성공하면 실패 이력을 지우고 다음 정기 차례로 되돌린다.
      await this.incrementalRepository.recordRepositorySuccess(
        repository.githubRepositoryId,
        this.now(),
      );
      return { kind: 'PROCESSED' };
    } catch (error) {
      if (error instanceof RunDeadlineError) {
        // 예산 소진은 실패가 아니다(#546) — stream에 오류 코드를 남기면
        // system-status가 정상적인 budget stop을 FAILED로 잘못 판정한다.
        return { kind: 'STOPPED_FOR_BUDGET' };
      }
      if (
        repository.source === 'EXTERNAL_PUBLIC' &&
        error instanceof CollectionAppClientError &&
        (error.kind === 'NOT_FOUND' || error.kind === 'PERMISSION')
      ) {
        const observedAt = this.now();
        await this.incrementalRepository.runInTransaction(async (repo) => {
          await repo.assertSyncLeaseValid(lease, observedAt);
          await repo.markExternalRepositoryUnavailable(
            repository.githubRepositoryId,
            error.kind === 'NOT_FOUND' ? 'ABSENT' : 'PRIVATE',
            observedAt,
          );
        });
      }
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn({
        event: 'collection.sync.repository_failed',
        runId,
        githubRepositoryId: repository.githubRepositoryId.toString(),
        errorName,
      });
      // 실패를 `failureCount` + `nextRunAt` 백오프로 기록해 되돌아올 약속을 남긴다(DD1).
      await this.incrementalRepository.recordRepositoryFailure(
        repository.githubRepositoryId,
        this.now(),
      );
      return { kind: 'FAILED', errorName };
    }
  }

  /**
   * 저장소 하나의 stream을 차례로 동기화하고, 각 stream이 성공한 즉시 새 fact 수를
   * 보고한다. 모든 stream을 마친 뒤 한꺼번에 반환하면 앞 stream의 checkpoint가
   * 커밋된 뒤 다음 stream이 실패했을 때 실제 적재 건수가 sweep history에서 사라진다.
   */
  private async syncRepository(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    registeredGithubIds: RegisteredGithubIdSet,
    deadline: number,
    onStreamInserted: (
      streamType: CollectionStreamType,
      insertedCount: number,
    ) => void,
  ): Promise<void> {
    const [owner, name] = splitNameWithOwner(repository.nameWithOwner);
    // 팀원 목록은 저장소당 한 번만 읽어 모든 stream이 공유한다. 커밋은 이 목록으로 **취득
    // 범위**를 좁히고(author-scoped GraphQL), PR·릴리스·Issue는 author 인자가 없어 전량 받은 뒤
    // 이 목록으로 **적재를** 좁힌다(ADR-009 §4). stream마다 다시 읽으면 한 저장소를 처리하는
    // 도중에 팀원이 바뀌어 stream마다 기준이 갈라질 수 있다.
    //
    // **조회를 COMMIT stream의 `trackStreamOutcome` 안에 두는 것이 이 배치의 요점이다.**
    // 이 조회가 실패하면 그 사실이 `CollectionRepositoryStream.lastErrorCode`에 남아야 한다
    // (#546) — 밖으로 빼면 상위 catch가 로그만 남기고 stream 행은 깨끗한 채로 남아, 운영자가
    // `system-status`로 "수집이 왜 멈췄는지"를 판정할 근거를 잃는다. 저장소당 1회로 줄이면서
    // 그 fencing까지 지키는 배치가 이것뿐이다.
    //
    // `defaultBranch`가 null인 빈 저장소에서도 조회를 건너뛰지 않는다. 건너뛰면 `teamMembers`가
    // null이 되어 PR·릴리스가 **거르지 않는** 갈래로 떨어지기 때문이다 — 빈 저장소에 PR·릴리스가
    // 있을 수 없다는 전제에 fail-open을 매다는 셈이라, 조회 1회를 아끼자고 할 거래가 아니다.
    //
    // 팀을 특정할 수 없는 저장소는 provider 조회 범위를 줄일 수 없어서 전량을 받는다.
    // 최종 fact writer는 source와 무관하게 `githubId ∈ User`를 다시 강제하므로
    // 가입하지 않은 제3자 신원은 저장하지 않는다.
    const { teamMembers, insertedCount: commitCount } =
      await this.trackStreamOutcome(
        lease,
        repository.id,
        'COMMIT',
        async () => {
          const members =
            await this.incrementalRepository.listRepositoryTeamMembers(
              repository.githubRepositoryId,
            );
          // TeamMember/User 관계도 run 시작 뒤 바뀔 수 있다. 이 run의 User snapshot에
          // 없던 계정까지 fingerprint에 넣으면 fact는 거르면서 "백필 완료"만 기록해
          // 다음 run이 과거 PR을 영구히 건너뛴다. 모든 stream과 fingerprint가 같은
          // snapshot으로 좁힌 목록을 공유한다.
          const registeredMembers =
            members === null
              ? null
              : members.filter((member) =>
                  registeredGithubIds.has(member.githubId),
                );
          return {
            teamMembers: registeredMembers,
            insertedCount: await this.syncCommitStream(
              runtime,
              lease,
              repository,
              owner,
              name,
              registeredMembers,
              registeredGithubIds,
              deadline,
            ),
          };
        },
      );
    onStreamInserted('COMMIT', commitCount);
    const pullRequestCount = await this.trackStreamOutcome(
      lease,
      repository.id,
      'PULL_REQUEST',
      () =>
        this.syncPullRequestStream(
          runtime,
          lease,
          repository,
          owner,
          name,
          teamMembers,
          registeredGithubIds,
          deadline,
        ),
    );
    onStreamInserted('PULL_REQUEST', pullRequestCount);
    const releaseCount = await this.trackStreamOutcome(
      lease,
      repository.id,
      'RELEASE',
      () =>
        this.syncReleaseStream(
          runtime,
          lease,
          repository,
          owner,
          name,
          teamMembers,
          registeredGithubIds,
          deadline,
        ),
    );
    onStreamInserted('RELEASE', releaseCount);
    // Issue는 마지막이다. 새로 생긴 stream이 실패해도 앞 세 stream의 checkpoint는 이미 커밋된
    // 뒤다. `Issues: read`는 선택 권한이라, installation이 아직 승인하지 않은 권한 오류는 ISSUE
    // 행에만 남기고 저장소를 실패로 돌리지 않는다 — 실패로 돌리면 저장소 백오프에 걸려 Commit·
    // PR·Release까지 몇 시간씩 쉰다.
    let issueCount = 0;
    try {
      issueCount = await this.trackStreamOutcome(
        lease,
        repository.id,
        'ISSUE',
        () =>
          this.syncIssueStream(
            runtime,
            lease,
            repository,
            owner,
            name,
            teamMembers,
            registeredGithubIds,
            deadline,
          ),
      );
    } catch (error) {
      if (!(
        error instanceof CollectionAppClientError && error.kind === 'PERMISSION'
      )) {
        throw error;
      }
    }
    onStreamInserted('ISSUE', issueCount);
    if (teamMembers !== null) {
      await this.observeOutsiderContributions(
        runtime,
        repository,
        owner,
        name,
        teamMembers,
        deadline,
      );
    }
  }

  /**
   * #546 — repo 단위 실패가 `CollectionRepositoryStream.lastErrorCode`에 남지 않아
   * `system-status`가 FAILED로 판정할 근거를 얻지 못하고, 공개 사용자는 stale 값만 봤다.
   * 이 래퍼가 stream 하나의 결과를 그 stream 행에 반영한다 — 실패면 오류 코드를 기록하고
   * 원래 예외를 그대로 다시 던지며, 성공이면 확인한 시각을 남기고 오류 표시를 지운다.
   *
   * 성공 기록이 checkpoint 안이 아니라 여기 있는 이유: 변경 없는 READY stream은
   * checkpoint를 아예 쓰지 않고 조기 반환하므로, checkpoint에만 두면 한 번 실패한 저장소가
   * 내용이 바뀔 때까지 영구히 FAILED로 남고, 확인 시각도 마지막으로 바뀐 시각에 멈춘다
   * (#1133 — 시스템 상태 Issue 칸이 매시 수집 중에도 「12시간 전」으로 보였다).
   *
   * `RunDeadlineError`는 오류가 아니라 run budget 소진이므로 기록하지 않는다.
   *
   * 반환 타입이 제네릭인 이유: COMMIT stream은 적재 건수뿐 아니라 **팀원 목록**도 함께
   * 돌려줘야 한다(그 조회가 이 fencing 안에서 일어나야 하므로 — `syncRepository` 참고).
   * 나머지 두 stream은 종전대로 `number`로 인스턴스화된다.
   */
  private async trackStreamOutcome<T>(
    lease: SyncLeaseToken,
    repositoryId: string,
    streamType: CollectionStreamType,
    operation: () => Promise<T>,
  ): Promise<T> {
    let outcome: T;
    try {
      outcome = await operation();
    } catch (error) {
      if (!(error instanceof RunDeadlineError)) {
        await this.writeStreamOutcome(lease, repositoryId, streamType, {
          lastErrorAt: this.now(),
          lastErrorCode: streamErrorCode(error),
        });
      }
      throw error;
    }
    await this.writeStreamOutcome(lease, repositoryId, streamType, {
      checkedAt: this.now(),
    });
    return outcome;
  }

  /**
   * 결과 표시는 bookkeeping이라 실패해도 원래 결과·예외를 덮지 않는다 — lease를 이미 잃은
   * run이라면 fenced 트랜잭션이 거부하는 것이 정상이고, 그 경우 조용히 넘어간다.
   */
  private async writeStreamOutcome(
    lease: SyncLeaseToken,
    repositoryId: string,
    streamType: CollectionStreamType,
    outcome: Parameters<
      CollectionIncrementalRepository['markStreamOutcome']
    >[2],
  ): Promise<void> {
    try {
      await this.incrementalRepository.runInTransaction(async (repo) => {
        await repo.assertSyncLeaseValid(lease, this.now());
        await repo.markStreamOutcome(repositoryId, streamType, outcome);
      });
    } catch (error) {
      this.logger.warn({
        event: 'collection.sync.stream_state_write_failed',
        streamType,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private async syncCommitStream(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    owner: string,
    name: string,
    teamMembers: readonly RepositoryTeamMemberAccount[] | null,
    registeredGithubIds: RegisteredGithubIdSet,
    deadline: number,
  ): Promise<number> {
    const defaultBranch = repository.defaultBranch;
    if (defaultBranch === null) {
      // Empty repository — GitHub reports no default branch when a
      // repository has zero commits, so there is nothing to sync yet. Leave
      // the stream frontier untouched (no provider call, no write) so a real
      // backfill runs once the repository gets its first commit and a later
      // observation reports an actual default branch.
      return 0;
    }

    // 팀원 단위 author-scoped 수집(멤버 활동 → 팀 활동 → 프로그램 활동). `TeamMember.userId`가
    // `User` FK를 강제하므로 팀원은 정의상 전부 가입자다 — author로 걸러도 팀 활동은 하나도
    // 잃지 않는다. 팀을 특정할 수 없는 저장소(`null`)만 아래 저장소 전량 REST 경로로 떨어진다.
    if (teamMembers !== null) {
      return this.syncTeamScopedCommitStream(
        runtime,
        lease,
        repository,
        owner,
        name,
        defaultBranch,
        teamMembers,
        registeredGithubIds,
        deadline,
      );
    }

    const existing = await this.incrementalRepository.getStreamFrontier(
      repository.id,
      'COMMIT',
    );
    const needsBackfill = !existing || existing.status !== 'READY';

    if (needsBackfill) {
      const result = await this.beforeDeadline(
        runtime.client.listCommitsUntilKnownSha(
          owner,
          name,
          defaultBranch,
          new Set(),
        ),
        deadline,
      );
      return this.commitCheckpoint(
        lease,
        repository.id,
        result.commits,
        registeredGithubIds,
        result.commits[0]?.sha ?? null,
        requestFingerprintKey(result.fingerprint),
        null,
      );
    }

    const probe = await this.beforeDeadline(
      runtime.client.probeDefaultBranchHead(
        owner,
        name,
        defaultBranch,
        existing.etag,
      ),
      deadline,
    );
    if (!probe.changed) return 0; // no full-history call for an unchanged READY repo

    const known = existing.frontierSha
      ? new Set([existing.frontierSha])
      : new Set<string>();
    const result = await this.beforeDeadline(
      runtime.client.listCommitsUntilKnownSha(
        owner,
        name,
        defaultBranch,
        known,
      ),
      deadline,
    );
    const headSha = probe.headSha ?? result.commits[0]?.sha ?? null;
    return this.commitCheckpoint(
      lease,
      repository.id,
      result.commits,
      registeredGithubIds,
      headSha,
      requestFingerprintKey(result.fingerprint),
      probe.etag,
    );
  }

  /**
   * 팀원 하나하나에 대해 `resolveUserNodeId` → `listDefaultBranchCommitsByAuthor`를 돌리고
   * 결과를 합쳐 기존 `commitCheckpoint` 경로로 적재한다. 저장소당 팀원은 보통 1~5명이고
   * `history(author:)`는 전체 이력을 받아도 rate-limit 1점이라, 저장소 전량 페이징(예:
   * 217 요청)보다 훨씬 싸다.
   *
   * **frontier를 읽지도 쓰지도 않는다(옵션 b).** 저장소당 하나뿐인 frontier로는 "기존
   * 팀원은 증분, 새 팀원은 전체 이력"을 표현할 수 없는데, `since`를 생략해도 비용이 1점이라
   * 증분의 이득이 사실상 없다. 그래서 매 run 팀원별 전체 이력을 다시 받고 중복은
   * `@@unique([repositoryId, sha])`(=`createMany` + `skipDuplicates`)가 막는다 — 새 팀원의
   * 과거 이력이 별도 백필 코드 없이 다음 run에 자동으로 들어온다.
   *
   * checkpoint에는 `frontierSha`/`etag`를 **null**로 남긴다. 여기서 본 최신 커밋은 팀원의
   * 커밋일 뿐 브랜치 head가 아니므로, 나중에 이 저장소가 팀을 잃어 REST 경로로 떨어질 때
   * 그 값을 known SHA로 쓰면 그 아래 이력이 통째로 잘린다. null이면 REST 경로가 정상적으로
   * 전체 백필을 다시 수행한다.
   *
   * `resolveUserNodeId`가 null(삭제·개명된 GitHub 계정 등)이면 그 팀원만 건너뛰고 나머지
   * 팀원 수집은 계속한다 — 계정 하나 때문에 저장소 전체 stream을 실패시키지 않는다.
   */
  private async syncTeamScopedCommitStream(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    owner: string,
    name: string,
    defaultBranch: string,
    members: readonly RepositoryTeamMemberAccount[],
    registeredGithubIds: RegisteredGithubIdSet,
    deadline: number,
  ): Promise<number> {
    const bySha = new Map<string, CollectionCommit>();
    for (const member of members) {
      const authorNodeId = await this.beforeDeadline(
        runtime.client.resolveUserNodeId(member.nickname),
        deadline,
      );
      if (authorNodeId === null) {
        this.logger.warn({
          event: 'collection.sync.team_member_node_id_unresolved',
          githubRepositoryId: repository.githubRepositoryId.toString(),
          githubUserId: member.githubId.toString(),
        });
        continue;
      }
      const authored = await this.beforeDeadline(
        runtime.client.listDefaultBranchCommitsByAuthor(
          owner,
          name,
          defaultBranch,
          authorNodeId,
        ),
        deadline,
      );
      for (const commit of authored) bySha.set(commit.sha, commit);
    }

    const teamCommits = [...bySha.values()];
    return this.commitCheckpoint(
      lease,
      repository.id,
      teamCommits,
      registeredGithubIds,
      null,
      TEAM_SCOPED_COMMIT_FINGERPRINT,
      null,
    );
  }

  /**
   * 「팀원이 아닌 사람의 기여」(#1133) — 팀 저장소에서 프로그램 기간 안 지금 팀원이 아닌 사람의
   * Commit·PR·Issue **수만** 세어 저장소 행 하나로 덮어쓴다. 누가 했는지는 저장하지 않는다.
   *
   * 매 run 기간 전체를 다시 센다 — 팀원이 바뀌거나 기간이 바뀌어도 다음 run이 저절로 맞춘다.
   * 단, 끝난 프로그램을 끝난 뒤 한 번 셌으면 더는 세지 않는다.
   * ponytail: 프로그램이 끝난 뒤 팀원을 바꾸면 그 합계에 반영되지 않는다 — 필요해지면 센 기준에
   * 팀원 명단의 지문을 더한다.
   * 네 stream과 달리 실패해도 저장소 수집을 실패로 돌리지 않는다: 이 합계는 교직원 화면의 보조
   * 한 줄이라, 여기서 난 오류로 Commit·PR·Issue 수집이 백오프에 걸리면 안 된다. 실패하면 옛 값을
   * 둔다(읽는 쪽이 기준 프로그램·기간이 맞을 때만 보인다).
   */
  private async observeOutsiderContributions(
    runtime: CollectionSyncRuntime,
    repository: CollectionRepositoryRow,
    owner: string,
    name: string,
    teamMembers: readonly RepositoryTeamMemberAccount[],
    deadline: number,
  ): Promise<void> {
    try {
      const window =
        await this.incrementalRepository.findOutsiderCountingWindow(
          repository.id,
        );
      if (window === null) return;
      // 끝난 프로그램을 끝난 뒤 이미 셌다면 기간이 닫혀 수가 바뀌지 않는다 — 다시 세면 프로그램이
      // 끝난 뒤 쌓인 PR·Issue까지 매시간 처음부터 거슬러 읽게 된다.
      if (
        window.countedThrough !== null &&
        window.countedThrough.getTime() >= window.endAt.getTime()
      )
        return;
      const observedAt = this.now();
      const since = Math.max(window.startAt.getTime(), GITHUB_EPOCH_MS);
      const until = Math.min(window.endAt.getTime(), observedAt.getTime());
      const memberIds = teamMemberGithubIds(teamMembers);
      const counted = (
        items: readonly {
          readonly authorGithubId: string | null;
          readonly authorLogin: string | null;
          readonly createdAt: string;
        }[],
      ): number =>
        items.filter(
          (item) =>
            Date.parse(item.createdAt) >= since &&
            Date.parse(item.createdAt) <= until &&
            isOutsiderAuthor(item, memberIds),
        ).length;

      let commitCount = 0;
      let pullRequestCount = 0;
      let issueCount = 0;
      if (since < until) {
        // 기간 시작 시각을 커서로 주면 목록이 그 앞에서 멈춘다(최신순이라 기간 안 항목만 읽는다).
        const windowStart = {
          createdAt: new Date(since).toISOString(),
          id: '0',
        };
        // 커밋은 ADR-009 「외부 = 전체 − 팀원합」으로 센다 — 기간 전체 수는 노드 없는 1점 조회라
        // 인기 저장소를 연결해도 이력을 페이지로 받지 않는다. 그래서 커밋만은 봇이나 계정에
        // 연결되지 않은 이메일의 커밋을 가려내지 못하고 함께 센다(PR·Issue는 작성자로 가린다).
        if (repository.defaultBranch !== null) {
          const total = await this.beforeDeadline(
            runtime.client.countDefaultBranchCommitsBetween(
              owner,
              name,
              repository.defaultBranch,
              githubTimestamp(new Date(since)),
              githubTimestamp(new Date(until)),
            ),
            deadline,
          );
          const team = await this.incrementalRepository.countTeamCommitsBetween(
            repository.id,
            [...memberIds],
            new Date(since),
            new Date(until),
          );
          // 관측 시점이 어긋나 전체가 팀원합보다 작으면 이번 값은 믿을 수 없다 — 음수를 남기거나
          // 0으로 뭉개지 않고 옛 값을 둔다.
          if (total !== null && total < team) return;
          commitCount = total === null ? 0 : total - team;
        }
        pullRequestCount = counted(
          (
            await this.beforeDeadline(
              runtime.client.listNewPullRequests(owner, name, windowStart),
              deadline,
            )
          ).pullRequests,
        );
        issueCount = counted(
          (
            await this.beforeDeadline(
              runtime.client.listNewIssues(owner, name, windowStart),
              deadline,
            )
          ).issues,
        );
      }
      await this.incrementalRepository.saveOutsiderContribution({
        repositoryId: repository.id,
        applicationId: window.applicationId,
        programId: window.programId,
        windowStartAt: window.startAt,
        windowEndAt: window.endAt,
        commitCount,
        pullRequestCount,
        issueCount,
        observedAt,
      });
    } catch (error) {
      if (error instanceof RunDeadlineError) throw error;
      this.logger.warn({
        event: 'collection.sync.outsider_contribution_failed',
        githubRepositoryId: repository.githubRepositoryId.toString(),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private async commitCheckpoint(
    lease: SyncLeaseToken,
    repositoryId: string,
    commits: readonly CollectionCommit[],
    registeredGithubIds: RegisteredGithubIdSet,
    headSha: string | null,
    requestFingerprint: string,
    etag: string | null,
  ): Promise<number> {
    return this.incrementalRepository.runInTransaction(async (repo) => {
      await repo.assertSyncLeaseValid(lease, this.now());
      const recorded = await repo.recordCommitFacts(
        repositoryId,
        commits.map((commit) => ({
          sha: commit.sha,
          committedAt: new Date(commit.committedAt),
          authorGithubId:
            commit.authorGithubId === null
              ? null
              : BigInt(commit.authorGithubId),
          authorGithubLogin: commit.authorLogin,
        })),
        registeredGithubIds,
      );
      await repo.upsertStreamFrontier({
        repositoryId,
        streamType: 'COMMIT',
        status: 'READY',
        frontierSha: headSha,
        requestFingerprint,
        etag,
        lastRunAt: this.now(),
      });
      return recorded.insertedCount;
    });
  }

  /**
   * PR은 GraphQL에도 `author` 인자가 없어 전량 받은 뒤 적재 직전에 거른다(ADR-009 §4).
   *
   * **거르기는 커서 계산에 절대 끼어들지 않는다.** 이 stream의 커서는 두 값이다 —
   * "이번 페이징을 어디서 멈출까"를 정하는 `tieFrontier`(입력)와 "다음 run이 어디서 멈출까"를
   * 정하는 `result.newFrontier`(출력). 둘 다 provider가 돌려준 **거르기 전** 목록에서만
   * 나온다: `tieFrontier`는 저장된 frontier row에서 읽고, `newFrontier`는
   * `listNewPullRequests`가 자기 `pullRequests[0]`(가장 새 PR, 작성자 무관)로 계산한다.
   * 아래 조기 반환도 거르기 전 길이를 본다.
   *
   * 그래서 한 페이지가 전부 비팀원 PR이어도 frontier는 그 페이지 너머로 전진하고,
   * 다음 run은 같은 PR을 다시 받지 않는다. 반대로 거른 뒤 길이로 조기 반환했다면 frontier가
   * 제자리에 남아 매 run 같은 페이지를 영원히 다시 받았을 것이다.
   *
   * 팀을 특정할 수 있는 저장소는 현재 팀원 id 집합의 fingerprint도 stream의 `frontierSha`에
   * 함께 checkpoint한다. 기존 값과 달라진 sweep(신규 합류 포함)에만 `tieFrontier`를 null로
   * 만들어 전체 PR을 한 번 다시 받고, 같은 fingerprint가 저장된 다음 sweep부터는 곧바로
   * 증분 커서를 재사용한다. fingerprint와 fact·PR frontier가 같은 fenced transaction에서
   * 저장되므로 중간 실패 뒤에도 백필 완료를 잘못 표시하지 않는다.
   */
  private async syncPullRequestStream(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    owner: string,
    name: string,
    teamMembers: readonly RepositoryTeamMemberAccount[] | null,
    registeredGithubIds: RegisteredGithubIdSet,
    deadline: number,
  ): Promise<number> {
    const existing = await this.incrementalRepository.getStreamFrontier(
      repository.id,
      'PULL_REQUEST',
    );
    const teamMembershipFrontier =
      teamMembers === null
        ? null
        : pullRequestTeamMembershipFrontier(teamMembers);
    const membershipUnchanged =
      teamMembershipFrontier === null ||
      existing?.frontierSha === teamMembershipFrontier;
    const tieFrontier =
      existing &&
      existing.status === 'READY' &&
      membershipUnchanged &&
      existing.frontierCreatedAt &&
      existing.frontierEntityId !== null
        ? {
            createdAt: existing.frontierCreatedAt.toISOString(),
            id: existing.frontierEntityId.toString(),
          }
        : null;

    const result = await this.beforeDeadline(
      runtime.client.listNewPullRequests(owner, name, tieFrontier),
      deadline,
    );
    if (tieFrontier !== null && result.pullRequests.length === 0) return 0;

    return this.pullRequestCheckpoint(
      lease,
      repository.id,
      this.onlyTeamAuthored(result.pullRequests, teamMembers),
      registeredGithubIds,
      result.newFrontier,
      requestFingerprintKey(result.fingerprint),
      teamMembershipFrontier,
    );
  }

  /**
   * ADR-009 «PR·릴리스는 적재 시 거른다»의 실행 지점 하나.
   *
   * 팀을 특정할 수 없으면 provider 결과를 그대로 다음 단계에 넘긴다. 이후 중앙 fact writer가
   * source와 무관하게 `githubId ∈ User`를 적용하므로 제3자 신원은 저장되지 않는다.
   *
   * 거른 결과는 **fact 적재에만** 넘긴다. 집계는 `recordPullRequestFacts`/
   * `recordReleaseFacts`가 자기가 받은 fact의 author로만 재계산하므로
   * (`collection-incremental.repository.ts`의 `rebuildAffectedContributions`), facts에 안 들어간
   * 작성자는 `Contribution` 행도 얻지 못한다. 집계 쪽을 따로 손댈
   * 필요가 없는 이유가 이것이다.
   */
  private onlyTeamAuthored<T extends { authorGithubId: string | null }>(
    items: readonly T[],
    teamMembers: readonly RepositoryTeamMemberAccount[] | null,
  ): readonly T[] {
    if (teamMembers === null) return items;
    const memberIds = teamMemberGithubIds(teamMembers);
    return items.filter((item) =>
      isTeamMemberAuthor(item.authorGithubId, memberIds),
    );
  }

  private async pullRequestCheckpoint(
    lease: SyncLeaseToken,
    repositoryId: string,
    pullRequests: readonly CollectionPullRequest[],
    registeredGithubIds: RegisteredGithubIdSet,
    newFrontier: { createdAt: string; id: string } | null,
    requestFingerprint: string,
    teamMembershipFrontier: string | null,
  ): Promise<number> {
    return this.incrementalRepository.runInTransaction(async (repo) => {
      await repo.assertSyncLeaseValid(lease, this.now());
      const recorded = await repo.recordPullRequestFacts(
        repositoryId,
        pullRequests.map((pullRequest) => ({
          githubPullRequestId: BigInt(pullRequest.id),
          state: pullRequest.state,
          createdAt: new Date(pullRequest.createdAt),
          authorGithubId:
            pullRequest.authorGithubId === null
              ? null
              : BigInt(pullRequest.authorGithubId),
          authorGithubLogin: pullRequest.authorLogin,
        })),
        registeredGithubIds,
      );
      await repo.upsertStreamFrontier({
        repositoryId,
        streamType: 'PULL_REQUEST',
        status: 'READY',
        frontierSha: teamMembershipFrontier,
        frontierCreatedAt: newFrontier ? new Date(newFrontier.createdAt) : null,
        frontierEntityId: newFrontier ? BigInt(newFrontier.id) : null,
        requestFingerprint,
        lastRunAt: this.now(),
      });
      return recorded.insertedCount;
    });
  }

  /**
   * 릴리스도 PR과 같은 이유로 전량 받은 뒤 적재 직전에 거른다(ADR-009 §4).
   *
   * **커서와 거르기가 아예 다른 요청에서 나온다.** 이 stream의 커서(`frontierSha`에 담기는
   * `probe.frontier.probe`와 조건부 GET용 `probe.etag`)는 전부 `probeLatestRelease`의
   * 응답이고, 거르는 대상은 그 뒤 `listChangedPublishedReleases`가 돌려준 목록이다. 목록에서
   * 무엇을 버리든 probe가 만든 값은 바뀌지 않으므로, 전부 걸러도 etag는 전진하고 다음 run은
   * 304로 목록 호출 자체를 건너뛴다.
   *
   * PR과 달리 이쪽은 백필 성질이 남는다 — `listChangedPublishedReleases`는 매번 발행된
   * 릴리스 **전량**을 다시 받으므로(증분 커서 없음), 나중에 합류한 팀원의 과거 릴리스는
   * 그 저장소에 릴리스 변화가 한 번 생겨 probe가 깨지는 시점에 들어온다.
   */
  private async syncReleaseStream(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    owner: string,
    name: string,
    teamMembers: readonly RepositoryTeamMemberAccount[] | null,
    registeredGithubIds: RegisteredGithubIdSet,
    deadline: number,
  ): Promise<number> {
    const existing = await this.incrementalRepository.getStreamFrontier(
      repository.id,
      'RELEASE',
    );
    const previousEtag =
      existing && existing.status === 'READY' ? existing.etag : null;

    const probe = await this.beforeDeadline(
      runtime.client.probeLatestRelease(owner, name, previousEtag),
      deadline,
    );
    if (!probe.changed) return 0; // no full listing call for an unchanged READY repo

    const listing = await this.beforeDeadline(
      runtime.client.listChangedPublishedReleases(owner, name),
      deadline,
    );
    return this.releaseCheckpoint(
      lease,
      repository.id,
      this.onlyTeamAuthored(listing.releases, teamMembers),
      registeredGithubIds,
      probe.frontier ? probe.frontier.probe : null,
      requestFingerprintKey(probe.fingerprint),
      probe.etag,
    );
  }

  private async releaseCheckpoint(
    lease: SyncLeaseToken,
    repositoryId: string,
    releases: readonly CollectionRelease[],
    registeredGithubIds: RegisteredGithubIdSet,
    frontierProbe: string | null,
    requestFingerprint: string,
    etag: string | null,
  ): Promise<number> {
    return this.incrementalRepository.runInTransaction(async (repo) => {
      await repo.assertSyncLeaseValid(lease, this.now());
      const recorded = await repo.recordReleaseFacts(
        repositoryId,
        releases.map((release) => ({
          githubReleaseId: BigInt(release.id),
          publishedAt: new Date(release.publishedAt),
          authorGithubId:
            release.authorGithubId === null
              ? null
              : BigInt(release.authorGithubId),
          authorGithubLogin: release.authorLogin,
        })),
        registeredGithubIds,
      );
      await repo.upsertStreamFrontier({
        repositoryId,
        streamType: 'RELEASE',
        status: 'READY',
        frontierSha: frontierProbe,
        requestFingerprint,
        etag,
        lastRunAt: this.now(),
      });
      return recorded.insertedCount;
    });
  }

  /**
   * Issue도 PR과 같은 규칙이다(`syncPullRequestStream` 참고) — 저장된 `(createdAt, id)` 커서까지
   * 읽고, 팀원 집합 표식(`frontierSha`)이 바뀐 sweep만 커서를 버리고 한 번 전부 다시 읽으며,
   * 작성자 거르기는 적재 직전에만 한다. ISSUE stream 행이 아직 없는 저장소(배포 직후의 과거
   * Issue)도 같은 경로로 처음부터 읽힌다.
   *
   * 다른 점 하나: issues 목록에는 PR이 섞여 온다. client가 커서를 **첫 원본 항목(PR 포함)**에서
   * 뽑은 뒤 PR을 버리므로, "새로 읽은 것이 없다"는 거른 목록 길이가 아니라 커서가 그대로인지로
   * 판정한다 — 새 PR만 쌓인 페이지에서도 커서가 전진해야 다음 sweep이 같은 페이지를 다시
   * 받지 않는다.
   */
  private async syncIssueStream(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    owner: string,
    name: string,
    teamMembers: readonly RepositoryTeamMemberAccount[] | null,
    registeredGithubIds: RegisteredGithubIdSet,
    deadline: number,
  ): Promise<number> {
    const existing = await this.incrementalRepository.getStreamFrontier(
      repository.id,
      'ISSUE',
    );
    const teamMembershipFrontier =
      teamMembers === null
        ? null
        : pullRequestTeamMembershipFrontier(teamMembers);
    const tieFrontier =
      existing?.status === 'READY' &&
      (teamMembershipFrontier === null ||
        existing.frontierSha === teamMembershipFrontier) &&
      existing.frontierCreatedAt &&
      existing.frontierEntityId !== null
        ? {
            createdAt: existing.frontierCreatedAt.toISOString(),
            id: existing.frontierEntityId.toString(),
          }
        : null;

    const result = await this.beforeDeadline(
      runtime.client.listNewIssues(owner, name, tieFrontier),
      deadline,
    );
    if (tieFrontier !== null && result.newFrontier?.id === tieFrontier.id) {
      return 0;
    }

    const issues = this.onlyTeamAuthored(result.issues, teamMembers);
    return this.incrementalRepository.runInTransaction(async (repo) => {
      await repo.assertSyncLeaseValid(lease, this.now());
      const recorded = await repo.recordIssueFacts(
        repository.id,
        issues.map((issue) => ({
          githubIssueId: BigInt(issue.id),
          state: issue.state,
          createdAt: new Date(issue.createdAt),
          authorGithubId:
            issue.authorGithubId === null ? null : BigInt(issue.authorGithubId),
          authorGithubLogin: issue.authorLogin,
        })),
        registeredGithubIds,
      );
      await repo.upsertStreamFrontier({
        repositoryId: repository.id,
        streamType: 'ISSUE',
        status: 'READY',
        frontierSha: teamMembershipFrontier,
        frontierCreatedAt: result.newFrontier
          ? new Date(result.newFrontier.createdAt)
          : null,
        frontierEntityId: result.newFrontier
          ? BigInt(result.newFrontier.id)
          : null,
        requestFingerprint: requestFingerprintKey(result.fingerprint),
        lastRunAt: this.now(),
      });
      return recorded.insertedCount;
    });
  }

  private async withHeartbeat<T>(
    token: SyncLeaseToken,
    operation: () => Promise<T>,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    let rejectLeaseLoss: (error: unknown) => void = () => undefined;
    const leaseLoss = new Promise<never>((_, reject) => {
      rejectLeaseLoss = reject;
    });
    const schedule = (): void => {
      timer = setTimeout(() => {
        void this.heartbeat(token).then(
          () => {
            if (!stopped) schedule();
          },
          (error: unknown) => rejectLeaseLoss(error),
        );
      }, HEARTBEAT_MS);
      timer.unref();
    };
    schedule();
    try {
      return await Promise.race([operation(), leaseLoss]);
    } finally {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  }

  private heartbeat(token: SyncLeaseToken): Promise<void> {
    const now = this.now();
    return this.incrementalRepository.heartbeatSyncLease(
      token,
      now,
      new Date(now.getTime() + LEASE_MS),
    );
  }

  private async beforeDeadline<T>(
    operation: Promise<T>,
    deadline: number,
  ): Promise<T> {
    const remaining = deadline - this.now().getTime();
    if (remaining <= 0) throw new RunDeadlineError();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new RunDeadlineError()), remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
