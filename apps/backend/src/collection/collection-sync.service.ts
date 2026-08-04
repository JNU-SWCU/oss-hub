import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  CollectionAppClient,
  CollectionCommit,
  CollectionPullRequest,
  CollectionRelease,
} from './collection-app.client';
import { requestFingerprintKey } from './collection-app.frontier';
import { CollectionAppTokenProvider } from './collection-app.token';
import { ProviderRequestQueue } from './collection-provider-queue';
import type { CollectionIncrementalRepository } from './collection-incremental.repository';
import type {
  CollectionRepositoryRow,
  RepositorySource,
} from './collection-incremental.types';
import type { SyncLeaseToken } from './collection-sync.types';

const LEASE_MS = 10 * 60_000;
const HEARTBEAT_MS = 2 * 60_000;
const RUN_DEADLINE_MS = 45 * 60_000;

export interface CollectionSyncRuntime {
  appId: string;
  organizationLogin: string;
  tokens: CollectionAppTokenProvider;
  client: CollectionAppClient;
  queue: ProviderRequestQueue;
}

export type CollectionSyncRuntimeFactory = () =>
  CollectionSyncRuntime | Promise<CollectionSyncRuntime>;

class RunDeadlineError extends Error {}

export type CollectionSyncRunStatus =
  'SKIPPED_LEASE_HELD' | 'COMPLETED' | 'FAILED';

export interface CollectionSyncRunResult {
  runId: string;
  status: CollectionSyncRunStatus;
  inventoryComplete: boolean | null;
  processedRepositoryCount: number;
  cycleCompleted: boolean;
  stoppedForBudget: boolean;
}

type SyncRepository = Pick<
  CollectionIncrementalRepository,
  | 'runInTransaction'
  | 'getStreamFrontier'
  | 'upsertStreamFrontier'
  | 'recordCommitFacts'
  | 'recordPullRequestFacts'
  | 'recordReleaseFacts'
  | 'recordRepositoryObservation'
  | 'markAbsentRepositories'
  | 'listPresentRepositories'
  | 'listExternalRepositories'
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
    // E1 — external sweep credentials/runtime (OAuth App Basic Auth per
    // plan §4.2) are provisioned separately from the org installation
    // runtime above. Left undefined by existing callers (module wiring,
    // CLI) until that runtime factory is wired in; `runExternal` fails
    // closed with a clear error rather than silently reusing the org
    // installation-token client (which cannot read repos outside the
    // installation's scope).
    private readonly externalRuntimeFactory?: CollectionSyncRuntimeFactory,
  ) {}

  async run(ownerId: string): Promise<CollectionSyncRunResult> {
    const runtime = await this.runtimeFactory();
    const githubOrganizationId = await this.resolveGithubOrganizationId();
    return this.runSweep({
      source: 'ORG_PROVISIONED',
      scope: orgScope(runtime.organizationLogin),
      appId: BigInt(runtime.appId),
      ownerId,
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
  async runExternal(ownerId: string): Promise<CollectionSyncRunResult> {
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
      runtime,
      discoverInventory: () => this.syncExternalInventory(),
    });
  }

  private async runSweep(params: {
    source: RepositorySource;
    scope: string;
    appId: bigint;
    ownerId: string;
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
    const runId = this.createRunId();
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
        await this.syncRepository(runtime, lease, repository, deadline);
      } catch (error) {
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

  private async syncRepository(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    deadline: number,
  ): Promise<void> {
    const [owner, name] = splitNameWithOwner(repository.nameWithOwner);
    await this.syncCommitStream(
      runtime,
      lease,
      repository,
      owner,
      name,
      deadline,
    );
    await this.syncPullRequestStream(
      runtime,
      lease,
      repository,
      owner,
      name,
      deadline,
    );
    await this.syncReleaseStream(
      runtime,
      lease,
      repository,
      owner,
      name,
      deadline,
    );
  }

  private async syncCommitStream(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    owner: string,
    name: string,
    deadline: number,
  ): Promise<void> {
    const defaultBranch = repository.defaultBranch;
    if (defaultBranch === null) {
      // Empty repository — GitHub reports no default branch when a
      // repository has zero commits, so there is nothing to sync yet. Leave
      // the stream frontier untouched (no provider call, no write) so a real
      // backfill runs once the repository gets its first commit and a later
      // observation reports an actual default branch.
      return;
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
      await this.commitCheckpoint(
        lease,
        repository.id,
        result.commits,
        result.commits[0]?.sha ?? null,
        requestFingerprintKey(result.fingerprint),
        null,
      );
      return;
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
    if (!probe.changed) return; // no full-history call for an unchanged READY repo

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
    await this.commitCheckpoint(
      lease,
      repository.id,
      result.commits,
      headSha,
      requestFingerprintKey(result.fingerprint),
      probe.etag,
    );
  }

  private async commitCheckpoint(
    lease: SyncLeaseToken,
    repositoryId: string,
    commits: readonly CollectionCommit[],
    headSha: string | null,
    requestFingerprint: string,
    etag: string | null,
  ): Promise<void> {
    await this.incrementalRepository.runInTransaction(async (repo) => {
      await repo.assertSyncLeaseValid(lease, this.now());
      await repo.recordCommitFacts(
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
    });
  }

  private async syncPullRequestStream(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    owner: string,
    name: string,
    deadline: number,
  ): Promise<void> {
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
    if (tieFrontier !== null && result.pullRequests.length === 0) return;

    await this.pullRequestCheckpoint(
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
  ): Promise<void> {
    await this.incrementalRepository.runInTransaction(async (repo) => {
      await repo.assertSyncLeaseValid(lease, this.now());
      await repo.recordPullRequestFacts(
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
    });
  }

  private async syncReleaseStream(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    owner: string,
    name: string,
    deadline: number,
  ): Promise<void> {
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
    if (!probe.changed) return; // no full listing call for an unchanged READY repo

    const listing = await this.beforeDeadline(
      runtime.client.listChangedPublishedReleases(owner, name),
      deadline,
    );
    await this.releaseCheckpoint(
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
  ): Promise<void> {
    await this.incrementalRepository.runInTransaction(async (repo) => {
      await repo.assertSyncLeaseValid(lease, this.now());
      await repo.recordReleaseFacts(
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
