import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  COLLECTION_CLOCK_SKEW_MS,
  COLLECTION_WINDOW_MS,
} from './collection-app.config';
import type {
  CollectionContributionKind,
  CollectionRateLimit,
  CollectionRepositoryProbe,
} from './collection-app.client';
import type {
  CollectionIncrementalRepository,
  CollectionRepositoryRow,
  CollectionSyncRuntime,
  CollectionSyncRuntimeFactory,
  CollectionTarget,
  RepositorySource,
  SyncLeaseToken,
} from './collection-incremental.repository';
import { CollectionAppClientError } from './collection-app.error';
import { RunDeadlineError } from './collection-inventory.error';
import { CollectionSyncDeadlineService } from './collection-sync-deadline.service';
import { RepositoryUrlService } from './repository-url.service';

const LEASE_MS = 10 * 60_000;
const HEARTBEAT_MS = 2 * 60_000;
const RUN_DEADLINE_MS = 45 * 60_000;
const PROBE_BATCH_SIZE = 100;

const CONTRIBUTION_KINDS: readonly CollectionContributionKind[] = [
  'commit',
  'pull_request',
  'issue',
  'release',
];

export type CollectionRunKind = 'hourly' | 'weekly' | 'full';

type CollectionSyncRunStatus =
  'SKIPPED' | 'SKIPPED_LEASE_HELD' | 'COMPLETED' | 'FAILED';

export interface CollectionSyncRunResult {
  runId: string;
  status: CollectionSyncRunStatus;
  processedRepositoryCount: number;
  stoppedForBudget: boolean;
  insertedFactCount: number;
}

const idleRunResult = (
  runId: string,
  status: CollectionSyncRunStatus,
): CollectionSyncRunResult => ({
  runId,
  status,
  processedRepositoryCount: 0,
  stoppedForBudget: false,
  insertedFactCount: 0,
});

type RepositorySyncOutcome = 'PROCESSED' | 'FAILED' | 'STOPPED_FOR_BUDGET';

interface CycleStats {
  probeRequests: number;
  requests: number;
  pointsUsed: number;
  rateLimitRemaining: number | null;
  collectedRepos: number;
  succeededRepos: number;
  unavailableRepos: number;
  truncatedRepos: number;
  inserted: number;
  authorFilled: number;
}

const emptyStats = (): CycleStats => ({
  probeRequests: 0,
  requests: 0,
  pointsUsed: 0,
  rateLimitRemaining: null,
  collectedRepos: 0,
  succeededRepos: 0,
  unavailableRepos: 0,
  truncatedRepos: 0,
  inserted: 0,
  authorFilled: 0,
});

type SyncRepository = Pick<
  CollectionIncrementalRepository,
  | 'runInTransaction'
  | 'recordContributions'
  | 'recordRepositorySuccess'
  | 'refreshRepositoryObservation'
  | 'markRepositoryGone'
  | 'listCollectionTargets'
  | 'findCollectionTargetByLogicalKey'
  | 'acquireSyncLease'
  | 'heartbeatSyncLease'
  | 'releaseSyncLease'
  | 'assertSyncLeaseValid'
>;

const orgScope = (organizationLogin: string): string =>
  `org:${organizationLogin}`;
const EXTERNAL_SCOPE = 'external';

const isCollectionTarget = (repository: CollectionRepositoryRow): boolean =>
  repository.teamId != null;

const hasActivitySince = (
  lastSuccessAt: Date | null,
  probe: CollectionRepositoryProbe,
): boolean =>
  lastSuccessAt === null ||
  probe.activityAt.some((activityAt) => activityAt > lastSuccessAt);

const observationChanged = (
  repository: CollectionRepositoryRow,
  probe: CollectionRepositoryProbe,
): boolean =>
  repository.nameWithOwner !== probe.nameWithOwner ||
  repository.defaultBranch !== probe.defaultBranch ||
  repository.archived !== probe.archived ||
  repository.visibility !== (probe.private ? 'PRIVATE' : 'PUBLIC');

@Injectable()
export class CollectionSyncService {
  private readonly logger = new Logger(CollectionSyncService.name);
  private readonly deadline: CollectionSyncDeadlineService;

  constructor(
    private readonly incrementalRepository: SyncRepository,
    private readonly runtimeFactory: CollectionSyncRuntimeFactory,
    private readonly repositoryUrlService: RepositoryUrlService,
    private readonly now: () => Date = () => new Date(),
    private readonly createRunId: () => string = randomUUID,

    private readonly externalRuntimeFactory?: CollectionSyncRuntimeFactory,
  ) {
    this.deadline = new CollectionSyncDeadlineService(now);
  }

  async run(
    ownerId: string,
    runId: string = this.createRunId(),
    kind: CollectionRunKind = 'hourly',
  ): Promise<CollectionSyncRunResult> {
    const runtime = await this.runtimeFactory();
    return this.withSyncLease(
      {
        appId: BigInt(runtime.appId),
        scope: orgScope(runtime.organizationLogin),
      },
      ownerId,
      runId,
      (lease, scope) =>
        this.sweep(runtime, lease, 'ORG_PROVISIONED', scope, runId, kind),
    );
  }

  async runExternal(
    ownerId: string,
    runId: string = this.createRunId(),
    kind: CollectionRunKind = 'hourly',
  ): Promise<CollectionSyncRunResult> {
    const runtime = await this.externalRuntime();
    return this.withSyncLease(
      { appId: BigInt(runtime.appId), scope: EXTERNAL_SCOPE },
      ownerId,
      runId,
      (lease, scope) =>
        this.sweep(runtime, lease, 'EXTERNAL_PUBLIC', scope, runId, kind),
    );
  }

  async runRepository(
    ownerId: string,
    githubRepositoryId: bigint,
    runId: string = this.createRunId(),
  ): Promise<CollectionSyncRunResult> {
    const repository =
      await this.incrementalRepository.findCollectionTargetByLogicalKey(
        githubRepositoryId,
      );
    if (
      repository === null ||
      !isCollectionTarget(repository) ||
      repository.presence !== 'PRESENT' ||
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
      const startedAt = this.now().getTime();
      const stats = emptyStats();
      const outcome = runtime.queue.shouldStop()
        ? 'STOPPED_FOR_BUDGET'
        : await this.collect(
            runtime,
            lease,
            repository,
            new Date(startedAt - COLLECTION_WINDOW_MS),
            new Date(startedAt - COLLECTION_CLOCK_SKEW_MS),
            startedAt + RUN_DEADLINE_MS,
            stats,
            runId,
          );
      await this.incrementalRepository.releaseSyncLease(lease, this.now());
      return {
        ...idleRunResult(runId, 'COMPLETED'),
        processedRepositoryCount: outcome === 'PROCESSED' ? 1 : 0,
        stoppedForBudget: outcome === 'STOPPED_FOR_BUDGET',
        insertedFactCount: stats.inserted,
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

  private async withSyncLease(
    key: { appId: bigint; scope: string },
    ownerId: string,
    runId: string,
    work: (
      lease: SyncLeaseToken,
      scope: string,
    ) => Promise<CollectionSyncRunResult>,
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
      return await this.withHeartbeat(lease, () => work(lease, key.scope));
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

  private async sweep(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    source: RepositorySource,
    scope: string,
    runId: string,
    kind: CollectionRunKind,
  ): Promise<CollectionSyncRunResult> {
    const startedAt = this.now().getTime();
    const deadline = startedAt + RUN_DEADLINE_MS;
    const succeededAt = new Date(startedAt - COLLECTION_CLOCK_SKEW_MS);
    const since =
      kind === 'hourly' ? new Date(startedAt - COLLECTION_WINDOW_MS) : null;
    const stats = emptyStats();
    const targets =
      await this.incrementalRepository.listCollectionTargets(source);
    let stoppedForBudget = false;
    let status: CollectionSyncRunStatus = 'FAILED';

    try {
      const changed: CollectionRepositoryRow[] = [];
      for (
        let offset = 0;
        offset < targets.length && !stoppedForBudget;
        offset += PROBE_BATCH_SIZE
      ) {
        if (this.shouldStop(runtime, deadline)) {
          stoppedForBudget = true;
          break;
        }
        const batch = targets.slice(offset, offset + PROBE_BATCH_SIZE);
        const unchanged = await this.probe(
          runtime,
          lease,
          source,
          batch,
          kind,
          deadline,
          stats,
          changed,
          runId,
        ).catch((error: unknown) => {
          if (error instanceof RunDeadlineError) {
            stoppedForBudget = true;
            return [];
          }
          throw error;
        });
        await this.recordSuccess(lease, unchanged, succeededAt);
        stats.succeededRepos += unchanged.length;
      }

      for (const repository of changed) {
        if (stoppedForBudget || this.shouldStop(runtime, deadline)) {
          stoppedForBudget = true;
          break;
        }
        const outcome = await this.collect(
          runtime,
          lease,
          repository,
          since,
          succeededAt,
          deadline,
          stats,
          runId,
        );
        if (outcome === 'STOPPED_FOR_BUDGET') stoppedForBudget = true;
      }

      await this.incrementalRepository.releaseSyncLease(lease, this.now());
      status = 'COMPLETED';
      return {
        runId,
        status,
        processedRepositoryCount: stats.collectedRepos,
        stoppedForBudget,
        insertedFactCount: stats.inserted,
      };
    } finally {
      this.logger.log({
        event: 'collection.cycle.summary',
        runId,
        scope,
        kind,
        status,
        repos: targets.length,
        probeRequests: stats.probeRequests,
        collectedRepos: stats.collectedRepos,
        requests: stats.requests,
        inserted: stats.inserted,
        authorFilled: stats.authorFilled,
        pointsUsed: stats.pointsUsed,
        rateLimitRemaining: stats.rateLimitRemaining,
        durationMs: this.now().getTime() - startedAt,
        ...(kind === 'hourly'
          ? {}
          : {
              fullScanFailedRepos:
                targets.length - stats.succeededRepos - stats.unavailableRepos,
              truncatedRepos: stats.truncatedRepos,
            }),
      });
    }
  }

  private async probe(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    source: RepositorySource,
    batch: readonly CollectionTarget[],
    kind: CollectionRunKind,
    deadline: number,
    stats: CycleStats,
    changed: CollectionRepositoryRow[],
    runId: string,
  ): Promise<bigint[]> {
    const result = await this.deadline.run(
      runtime.client.probeRepositories(
        batch.map((target) => {
          const [owner, name] = this.repositoryUrlService.splitNameWithOwner(
            target.nameWithOwner,
          );
          return { owner, name };
        }),
      ),
      deadline,
    );
    stats.probeRequests += 1;
    stats.requests += 1;
    this.observeRateLimit(stats, result.rateLimit);

    const unchanged: bigint[] = [];
    for (const [index, target] of batch.entries()) {
      const probed = result.repositories[index] ?? null;
      if (
        probed === null ||
        BigInt(probed.githubRepositoryId) !== target.githubRepositoryId
      ) {
        const relocated = await this.relocate(
          runtime,
          lease,
          source,
          target,
          deadline,
          stats,
          runId,
        );
        if (relocated !== null) changed.push(relocated);
        continue;
      }
      const current = observationChanged(target, probed)
        ? await this.refresh(lease, source, target.githubRepositoryId, {
            nameWithOwner: probed.nameWithOwner,
            defaultBranch: probed.defaultBranch,
            archived: probed.archived,
            private: probed.private,
          })
        : target;
      if (current === null) {
        stats.unavailableRepos += 1;
        continue;
      }
      if (kind !== 'hourly' || hasActivitySince(target.lastSuccessAt, probed)) {
        changed.push(current);
      } else {
        unchanged.push(target.githubRepositoryId);
      }
    }
    return unchanged;
  }

  private async relocate(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    source: RepositorySource,
    target: CollectionTarget,
    deadline: number,
    stats: CycleStats,
    runId: string,
  ): Promise<CollectionRepositoryRow | null> {
    stats.requests += 1;
    try {
      const located = await this.deadline.run(
        runtime.client.getRepositoryById(target.githubRepositoryId),
        deadline,
      );
      if (BigInt(located.id) !== target.githubRepositoryId) {
        this.logRepositoryFailure(runId, target, 'RepositoryIdMismatch');
        return null;
      }
      const current = await this.refresh(
        lease,
        source,
        target.githubRepositoryId,
        {
          nameWithOwner: located.fullName,
          defaultBranch: located.defaultBranch,
          archived: located.archived,
          private: located.private,
        },
      );
      if (current === null) stats.unavailableRepos += 1;
      return current;
    } catch (error) {
      if (error instanceof RunDeadlineError) throw error;
      if (
        error instanceof CollectionAppClientError &&
        (error.kind === 'NOT_FOUND' || error.kind === 'PERMISSION')
      ) {
        const observedAt = this.now();
        await this.incrementalRepository.runInTransaction(async (repo) => {
          await repo.assertSyncLeaseValid(lease, observedAt);
          await repo.markRepositoryGone(
            target.githubRepositoryId,
            observedAt,
            source,
          );
        });
        stats.unavailableRepos += 1;
        return null;
      }
      if (this.failsRun(error)) throw error;
      this.logRepositoryFailure(runId, target, this.errorName(error));
      return null;
    }
  }

  private async refresh(
    lease: SyncLeaseToken,
    source: RepositorySource,
    githubRepositoryId: bigint,
    observed: {
      readonly nameWithOwner: string;
      readonly defaultBranch: string | null;
      readonly archived: boolean;
      readonly private: boolean;
    },
  ): Promise<CollectionRepositoryRow | null> {
    const observedAt = this.now();
    const refreshed = await this.incrementalRepository.runInTransaction(
      async (repo) => {
        await repo.assertSyncLeaseValid(lease, observedAt);
        return repo.refreshRepositoryObservation({
          source,
          githubRepositoryId,
          nameWithOwner: observed.nameWithOwner,
          defaultBranch: observed.defaultBranch,
          archived: observed.archived,
          visibility: observed.private ? 'PRIVATE' : 'PUBLIC',
          observedAt,
        });
      },
    );
    return refreshed !== null &&
      (source === 'ORG_PROVISIONED' || refreshed.visibility === 'PUBLIC')
      ? refreshed
      : null;
  }

  private async collect(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    repository: CollectionRepositoryRow,
    since: Date | null,
    succeededAt: Date,
    deadline: number,
    stats: CycleStats,
    runId: string,
  ): Promise<RepositorySyncOutcome> {
    const [owner, name] = this.repositoryUrlService.splitNameWithOwner(
      repository.nameWithOwner,
    );
    stats.collectedRepos += 1;
    try {
      const result = await this.deadline.run(
        runtime.client.collectRepositoryContributions(
          owner,
          name,
          repository.defaultBranch,
          since,
        ),
        deadline,
      );
      stats.requests += result.requests;
      stats.pointsUsed += result.pointsUsed;
      this.observeRateLimit(stats, result.rateLimit);
      await this.incrementalRepository.runInTransaction(async (repo) => {
        await repo.assertSyncLeaseValid(lease, this.now());
        for (const kind of CONTRIBUTION_KINDS) {
          const recorded = await repo.recordContributions(
            repository.githubRepositoryId,
            kind,
            result.contributions[kind],
          );
          stats.inserted += recorded.inserted;
          stats.authorFilled += recorded.authorFilled;
        }
        await repo.recordRepositorySuccess(
          [repository.githubRepositoryId],
          succeededAt,
        );
      });
      stats.succeededRepos += 1;
      return 'PROCESSED';
    } catch (error) {
      if (error instanceof RunDeadlineError) return 'STOPPED_FOR_BUDGET';
      if (this.failsRun(error)) throw error;
      if (
        error instanceof CollectionAppClientError &&
        (error.kind === 'PAGINATION' || error.kind === 'DEADLINE')
      ) {
        stats.truncatedRepos += 1;
      }
      this.logRepositoryFailure(runId, repository, this.errorName(error));
      return 'FAILED';
    }
  }

  private async recordSuccess(
    lease: SyncLeaseToken,
    githubRepositoryIds: readonly bigint[],
    succeededAt: Date,
  ): Promise<void> {
    if (githubRepositoryIds.length === 0) return;
    await this.incrementalRepository.runInTransaction(async (repo) => {
      await repo.assertSyncLeaseValid(lease, this.now());
      await repo.recordRepositorySuccess(githubRepositoryIds, succeededAt);
    });
  }

  private shouldStop(
    runtime: CollectionSyncRuntime,
    deadline: number,
  ): boolean {
    return this.now().getTime() >= deadline || runtime.queue.shouldStop();
  }

  private failsRun(error: unknown): boolean {
    return (
      error instanceof CollectionAppClientError && error.kind === 'RATE_LIMITED'
    );
  }

  private observeRateLimit(
    stats: CycleStats,
    rateLimit: CollectionRateLimit | null,
  ): void {
    if (rateLimit !== null) stats.rateLimitRemaining = rateLimit.remaining;
  }

  private errorName(error: unknown): string {
    if (error instanceof CollectionAppClientError)
      return `PROVIDER_${error.kind}`;
    return error instanceof Error ? error.name : 'UnknownError';
  }

  private logRepositoryFailure(
    runId: string,
    repository: CollectionRepositoryRow,
    errorName: string,
  ): void {
    this.logger.warn({
      event: 'collection.sync.repository_failed',
      runId,
      githubRepositoryId: repository.githubRepositoryId.toString(),
      errorName,
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
}
