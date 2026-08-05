import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  CollectionAppClient,
  CollectionAppClientError,
  CollectionAppClientTokenProvider,
  CollectionCommit,
  CollectionPullRequest,
  CollectionRelease,
} from './collection-app.client';
import { requestFingerprintKey } from './collection-app.frontier';
import { ProviderRequestQueue } from './collection-provider-queue';
import type { CollectionIncrementalRepository } from './collection-incremental.repository';
import type {
  CollectionRepositoryRow,
  CollectionStreamType,
  RepositorySource,
  RepositoryTeamMemberAccount,
} from './collection-incremental.types';
import type { SyncLeaseToken } from './collection-sync.types';

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

export type CollectionSyncRunStatus =
  'SKIPPED_LEASE_HELD' | 'COMPLETED' | 'FAILED';

export interface CollectionSyncRunResult {
  runId: string;
  status: CollectionSyncRunStatus;
  inventoryComplete: boolean | null;
  processedRepositoryCount: number;
  cycleCompleted: boolean;
  stoppedForBudget: boolean;
  /**
   * #511 — 이번 run이 새로 적재한 fact 수(commit/PR/release 합). 중복 fact는 세지 않는다
   * (`createMany`+`skipDuplicates`가 반환하는 실제 삽입 수만 누적). 트리거 표면이 성공
   * 로그에 "신규 수집 건수"를 남기기 위한 유일한 출처다.
   */
  insertedFactCount: number;
}

type SyncRepository = Pick<
  CollectionIncrementalRepository,
  | 'runInTransaction'
  | 'getStreamFrontier'
  | 'upsertStreamFrontier'
  | 'markStreamErrorState'
  | 'recordCommitFacts'
  | 'recordPullRequestFacts'
  | 'recordReleaseFacts'
  | 'recordRepositoryObservation'
  | 'markAbsentRepositories'
  | 'listPresentRepositories'
  | 'listExternalRepositories'
  | 'listRepositoryTeamMembers'
  | 'getSyncCursor'
  | 'upsertSyncCursor'
  | 'acquireSyncLease'
  | 'heartbeatSyncLease'
  | 'releaseSyncLease'
  | 'assertSyncLeaseValid'
>;

const compareBigint = (a: bigint, b: bigint): number =>
  a < b ? -1 : a > b ? 1 : 0;

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
 *   3) 저장소별로 commit/PR/release 세 stream을 순서대로 동기화한다. 새 stream row(및 backfill이
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
  async run(ownerId: string, runId?: string): Promise<CollectionSyncRunResult> {
    const runtime = await this.runtimeFactory();
    const githubOrganizationId = await this.resolveGithubOrganizationId();
    return this.runSweep({
      source: 'ORG_PROVISIONED',
      scope: orgScope(runtime.organizationLogin),
      appId: BigInt(runtime.appId),
      ownerId,
      runId,
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
    if (!this.externalRuntimeFactory) {
      throw new Error(
        'collection sync: external runtime not configured (runExternal requires an externalRuntimeFactory)',
      );
    }
    const runtime = await this.externalRuntimeFactory();
    return this.runSweep({
      source: 'EXTERNAL_PUBLIC',
      scope: EXTERNAL_SCOPE,
      appId: BigInt(runtime.appId),
      ownerId,
      runId,
      runtime,
      discoverInventory: () => this.syncExternalInventory(),
    });
  }

  private async runSweep(params: {
    source: RepositorySource;
    scope: string;
    appId: bigint;
    ownerId: string;
    runId?: string;
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
    const { scope, appId, ownerId, runtime, discoverInventory } = params;
    const key = { appId, scope };
    const runId = params.runId ?? this.createRunId();
    const acquiredAt = this.now();
    const lease = await this.incrementalRepository.acquireSyncLease({
      ...key,
      ownerId,
      runId,
      now: acquiredAt,
      expiresAt: new Date(acquiredAt.getTime() + LEASE_MS),
    });
    if (!lease) {
      return {
        runId,
        status: 'SKIPPED_LEASE_HELD',
        inventoryComplete: null,
        processedRepositoryCount: 0,
        cycleCompleted: false,
        stoppedForBudget: false,
        insertedFactCount: 0,
      };
    }

    try {
      return await this.withHeartbeat(lease, () =>
        this.syncSweep(runtime, lease, key, runId, discoverInventory),
      );
    } catch (error) {
      this.logger.error({
        event: 'collection.sync.failed',
        runId,
        scope,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      await this.incrementalRepository
        .releaseSyncLease(lease, this.now())
        .catch(() => undefined);
      return {
        runId,
        status: 'FAILED',
        inventoryComplete: null,
        processedRepositoryCount: 0,
        cycleCompleted: false,
        stoppedForBudget: false,
        insertedFactCount: 0,
      };
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
  ): Promise<CollectionSyncRunResult> {
    const deadline = this.now().getTime() + RUN_DEADLINE_MS;

    const inventory = await discoverInventory(lease, deadline);

    const cursor = await this.incrementalRepository.getSyncCursor(
      key.appId,
      key.scope,
    );
    const startAfter =
      cursor && cursor.cycleCompletedAt === null
        ? cursor.lastGithubRepositoryId
        : null;

    if (startAfter === null) {
      // Fresh cycle (no cursor yet, or the previous cycle already
      // wrapped around) — stamp the start once, up front.
      await this.incrementalRepository.runInTransaction(async (repo) => {
        await repo.assertSyncLeaseValid(lease, this.now());
        await repo.upsertSyncCursor({
          appId: key.appId,
          scope: key.scope,
          cycleStartedAt: this.now(),
          cycleCompletedAt: null,
        });
      });
    }

    const ordered = [...inventory.repositories]
      .filter(
        (repository) =>
          startAfter === null ||
          compareBigint(repository.githubRepositoryId, startAfter) > 0,
      )
      .sort((a, b) =>
        compareBigint(a.githubRepositoryId, b.githubRepositoryId),
      );

    let processedRepositoryCount = 0;
    let insertedFactCount = 0;
    let stoppedForBudget = false;
    let lastError: string | null = null;

    for (const repository of ordered) {
      if (this.now().getTime() >= deadline) {
        stoppedForBudget = true;
        break;
      }
      if (runtime.queue.shouldStop()) {
        stoppedForBudget = true;
        break;
      }
      try {
        insertedFactCount += await this.syncRepository(
          runtime,
          lease,
          repository,
          deadline,
        );
      } catch (error) {
        if (error instanceof RunDeadlineError) {
          // 예산 소진은 실패가 아니다(#546) — stream에 오류 코드를 남기면
          // system-status가 정상적인 budget stop을 FAILED로 잘못 판정한다.
          stoppedForBudget = true;
          break;
        }
        lastError = error instanceof Error ? error.name : 'UnknownError';
        this.logger.warn({
          event: 'collection.sync.repository_failed',
          runId,
          githubRepositoryId: repository.githubRepositoryId.toString(),
          errorName: lastError,
        });
        // Do not advance the cursor past a repository whose stream sync
        // failed — the next run retries it first rather than skipping it.
        break;
      }
      await this.incrementalRepository.runInTransaction(async (repo) => {
        await repo.assertSyncLeaseValid(lease, this.now());
        await repo.upsertSyncCursor({
          appId: key.appId,
          scope: key.scope,
          lastGithubRepositoryId: repository.githubRepositoryId,
        });
      });
      processedRepositoryCount += 1;
    }

    const cycleCompleted =
      !stoppedForBudget &&
      lastError === null &&
      processedRepositoryCount === ordered.length;
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
   * E1 external-side discovery — 학생이 이미 등록해 `EXTERNAL_PUBLIC` source로 저장된
   * 행을 그대로 읽는다. org discovery와 달리 provider 목록 호출이 없으므로 항상
   * complete다(자동 GraphQL 발견은 별도 과제이며 이 메서드의 범위가 아니다) — DB 조회
   * 자체가 실패하면 예외가 그대로 전파되어 상위 `run` 경로에서 FAILED로 처리된다.
   */
  private async syncExternalInventory(): Promise<SweepInventory> {
    const repositories =
      await this.incrementalRepository.listExternalRepositories();
    return { complete: true, repositories };
  }

  /** 저장소 하나가 이번 run에서 새로 적재한 fact 수를 반환한다(#511 성공 로그 집계용). */
  private async syncRepository(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    deadline: number,
  ): Promise<number> {
    const [owner, name] = splitNameWithOwner(repository.nameWithOwner);
    const commitCount = await this.trackStreamOutcome(
      lease,
      repository.id,
      'COMMIT',
      () =>
        this.syncCommitStream(
          runtime,
          lease,
          repository,
          owner,
          name,
          deadline,
        ),
    );
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
          deadline,
        ),
    );
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
          deadline,
        ),
    );
    return commitCount + pullRequestCount + releaseCount;
  }

  /**
   * #546 — repo 단위 실패가 `CollectionRepositoryStream.lastErrorCode`에 남지 않아
   * `system-status`가 FAILED로 판정할 근거를 얻지 못하고, 공개 사용자는 stale 값만 봤다.
   * 이 래퍼가 stream 하나의 결과를 그 stream 행에 반영한다 — 실패면 오류 코드를 기록하고
   * 원래 예외를 그대로 다시 던지며, 성공이면 남아 있던 오류 표시를 지운다.
   *
   * 성공 시의 해제가 checkpoint 안이 아니라 여기 있는 이유: 변경 없는 READY stream은
   * checkpoint를 아예 쓰지 않고 조기 반환하므로, checkpoint에만 두면 한 번 실패한 저장소가
   * 내용이 바뀔 때까지 영구히 FAILED로 남는다.
   *
   * `RunDeadlineError`는 오류가 아니라 run budget 소진이므로 기록하지 않는다.
   */
  private async trackStreamOutcome(
    lease: SyncLeaseToken,
    repositoryId: string,
    streamType: CollectionStreamType,
    operation: () => Promise<number>,
  ): Promise<number> {
    let insertedCount: number;
    try {
      insertedCount = await operation();
    } catch (error) {
      if (!(error instanceof RunDeadlineError)) {
        await this.writeStreamErrorState(lease, repositoryId, streamType, {
          lastErrorAt: this.now(),
          lastErrorCode: streamErrorCode(error),
        });
      }
      throw error;
    }
    await this.writeStreamErrorState(lease, repositoryId, streamType, {
      lastErrorAt: null,
      lastErrorCode: null,
    });
    return insertedCount;
  }

  /**
   * 오류 표시는 bookkeeping이라 실패해도 원래 결과·예외를 덮지 않는다 — lease를 이미 잃은
   * run이라면 fenced 트랜잭션이 거부하는 것이 정상이고, 그 경우 조용히 넘어간다.
   */
  private async writeStreamErrorState(
    lease: SyncLeaseToken,
    repositoryId: string,
    streamType: CollectionStreamType,
    state: { lastErrorAt: Date | null; lastErrorCode: string | null },
  ): Promise<void> {
    try {
      await this.incrementalRepository.runInTransaction(async (repo) => {
        await repo.assertSyncLeaseValid(lease, this.now());
        await repo.markStreamErrorState(repositoryId, streamType, state);
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
    const teamMembers =
      await this.incrementalRepository.listRepositoryTeamMembers(
        repository.githubRepositoryId,
      );
    if (teamMembers !== null) {
      return this.syncTeamScopedCommitStream(
        runtime,
        lease,
        repository,
        owner,
        name,
        defaultBranch,
        teamMembers,
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
    await this.observeExternalContribution(
      runtime,
      repository,
      owner,
      name,
      defaultBranch,
      teamCommits.length,
      deadline,
    );

    return this.commitCheckpoint(
      lease,
      repository.id,
      teamCommits,
      null,
      TEAM_SCOPED_COMMIT_FINGERPRINT,
      null,
    );
  }

  /**
   * 외부(비팀원) 기여 **수치만** 관측한다 — `전체 − 팀원합`. 개인 식별자(login·githubId)는
   * 요청도 저장도 하지 않는다: `countDefaultBranchCommits`는 커밋 노드를 하나도 받지 않고
   * `totalCount`만 읽는다.
   *
   * 저장 위치는 아직 정하지 않았다. 지금은 관측해 로그로만 남기고 버린다 — 이 값을 담을
   * 적절한 컬럼이 없으며, 추측으로 스키마를 늘리지 않는다.
   *
   * 전체가 `null`(브랜치 없음)이거나 팀원합보다 작으면(관측 시점 차이로 생기는 불일치)
   * 계산 자체를 건너뛴다. 음수를 남기거나 0으로 뭉개는 것은 조용한 오답이다.
   */
  private async observeExternalContribution(
    runtime: CollectionSyncRuntime,
    repository: CollectionRepositoryRow,
    owner: string,
    name: string,
    defaultBranch: string,
    teamCommitCount: number,
    deadline: number,
  ): Promise<void> {
    const totalCommitCount = await this.beforeDeadline(
      runtime.client.countDefaultBranchCommits(owner, name, defaultBranch),
      deadline,
    );
    if (totalCommitCount === null || totalCommitCount < teamCommitCount) return;
    this.logger.log({
      event: 'collection.sync.external_contribution_observed',
      githubRepositoryId: repository.githubRepositoryId.toString(),
      totalCommitCount,
      teamCommitCount,
      externalCommitCount: totalCommitCount - teamCommitCount,
    });
  }

  private async commitCheckpoint(
    lease: SyncLeaseToken,
    repositoryId: string,
    commits: readonly CollectionCommit[],
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

  private async syncPullRequestStream(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    owner: string,
    name: string,
    deadline: number,
  ): Promise<number> {
    const existing = await this.incrementalRepository.getStreamFrontier(
      repository.id,
      'PULL_REQUEST',
    );
    const tieFrontier =
      existing &&
      existing.status === 'READY' &&
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
      result.pullRequests,
      result.newFrontier,
      requestFingerprintKey(result.fingerprint),
    );
  }

  private async pullRequestCheckpoint(
    lease: SyncLeaseToken,
    repositoryId: string,
    pullRequests: readonly CollectionPullRequest[],
    newFrontier: { createdAt: string; id: string } | null,
    requestFingerprint: string,
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
      );
      await repo.upsertStreamFrontier({
        repositoryId,
        streamType: 'PULL_REQUEST',
        status: 'READY',
        frontierCreatedAt: newFrontier ? new Date(newFrontier.createdAt) : null,
        frontierEntityId: newFrontier ? BigInt(newFrontier.id) : null,
        requestFingerprint,
        lastRunAt: this.now(),
      });
      return recorded.insertedCount;
    });
  }

  private async syncReleaseStream(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    owner: string,
    name: string,
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
      listing.releases,
      probe.frontier ? probe.frontier.probe : null,
      requestFingerprintKey(probe.fingerprint),
      probe.etag,
    );
  }

  private async releaseCheckpoint(
    lease: SyncLeaseToken,
    repositoryId: string,
    releases: readonly CollectionRelease[],
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
