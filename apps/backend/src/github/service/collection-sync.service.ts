import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  CollectionAppClient,
  CollectionAppClientError,
  CollectionAppClientTokenProvider,
  CollectionCommit,
  CollectionPullRequest,
  CollectionRelease,
} from '../gateway/collection-app.client';
import { requestFingerprintKey } from '../domain/collection-app.frontier';
import { ProviderRequestQueue } from '../gateway/collection-provider-queue';
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

const TEAM_SCOPED_COMMIT_FINGERPRINT = 'graphql:history(author:)#first=100';

export interface CollectionSyncRuntime {
  appId: string;
  organizationLogin: string;

  tokens: CollectionAppClientTokenProvider;
  client: CollectionAppClient;
  queue: ProviderRequestQueue;
}

export type CollectionSyncRuntimeFactory = () =>
  CollectionSyncRuntime | Promise<CollectionSyncRuntime>;

class RunDeadlineError extends Error {}

export const DEFAULT_STREAM_ERROR_CODE = 'STREAM_SYNC_FAILED';

const streamErrorCode = (error: unknown): string =>
  error instanceof CollectionAppClientError
    ? `PROVIDER_${error.kind}`
    : DEFAULT_STREAM_ERROR_CODE;

export type CollectionSyncRunStatus =
  'SKIPPED' | 'SKIPPED_LEASE_HELD' | 'COMPLETED' | 'FAILED';

export interface CollectionSyncRunResult {
  runId: string;
  status: CollectionSyncRunStatus;
  inventoryComplete: boolean | null;
  processedRepositoryCount: number;
  cycleCompleted: boolean;
  stoppedForBudget: boolean;

  insertedFactCount: number;
}

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

type RepositorySyncOutcome =
  | { readonly kind: 'PROCESSED' }
  | { readonly kind: 'FAILED'; readonly errorName: string }
  | { readonly kind: 'STOPPED_FOR_BUDGET' }
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

const orgScope = (organizationLogin: string): string =>
  `org:${organizationLogin}`;
const EXTERNAL_SCOPE = 'external';

const teamMemberGithubIds = (
  members: readonly RepositoryTeamMemberAccount[],
): ReadonlySet<bigint> => new Set(members.map((member) => member.githubId));

const isTeamMemberAuthor = (
  authorGithubId: string | null,
  memberIds: ReadonlySet<bigint>,
): boolean => authorGithubId !== null && memberIds.has(BigInt(authorGithubId));

const isBotLogin = (login: string | null): boolean =>
  login !== null && login.toLowerCase().endsWith('[bot]');

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

const GITHUB_EPOCH_MS = Date.UTC(2008, 0, 1);

const githubTimestamp = (at: Date): string =>
  at.toISOString().replace(/\.\d{3}Z$/, 'Z');

const isCollectionTarget = (repository: CollectionRepositoryRow): boolean =>
  repository.applicationId != null ||
  (repository.source === 'ORG_PROVISIONED' &&
    repository.programId == null &&
    repository.teamId == null);

interface SweepInventory {
  readonly complete: boolean;
  readonly repositories: readonly CollectionRepositoryRow[];
}

@Injectable()
export class CollectionSyncService {
  private readonly logger = new Logger(CollectionSyncService.name);

  constructor(
    private readonly incrementalRepository: SyncRepository,
    private readonly runtimeFactory: CollectionSyncRuntimeFactory,
    private readonly resolveGithubOrganizationId: () => Promise<bigint>,
    private readonly now: () => Date = () => new Date(),
    private readonly createRunId: () => string = randomUUID,

    private readonly externalRuntimeFactory?: CollectionSyncRuntimeFactory,
  ) {}

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
        processedRepositoryCount += 1;
      } else if (outcome.kind === 'FAILED') {
        lastError = outcome.errorName;
        failedRepositoryCount += 1;
      }

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
      this.logger.warn({
        event: 'collection.sync.repositories_failed',
        runId,
        failedRepositoryCount,
        attemptedRepositoryCount,
        totalRepositoryCount: ordered.length,
        lastErrorName: lastError,
      });
    }

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

      await this.incrementalRepository.recordRepositorySuccess(
        repository.githubRepositoryId,
        this.now(),
      );
      return { kind: 'PROCESSED' };
    } catch (error) {
      if (error instanceof RunDeadlineError) {
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

      await this.incrementalRepository.recordRepositoryFailure(
        repository.githubRepositoryId,
        this.now(),
      );
      return { kind: 'FAILED', errorName };
    }
  }

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
      return 0;
    }

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
    if (!probe.changed) return 0;

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
        const windowStart = {
          createdAt: new Date(since).toISOString(),
          id: '0',
        };

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
    if (!probe.changed) return 0;

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
