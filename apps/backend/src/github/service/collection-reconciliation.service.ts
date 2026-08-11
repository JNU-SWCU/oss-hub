import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DomainException } from '../../common/error-code';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from '../collection-error-code.enum';
import {
  CollectionAppClient,
  CollectionAppClientError,
  CollectionCommit,
  CollectionPullRequest,
  CollectionRelease,
} from '../collection-app.client';
import { CollectionAppConfigError } from '../collection-app.config';
import {
  CollectionAppTokenError,
  CollectionAppTokenProvider,
} from '../collection-app.token';
import { CollectionCanonicalRepository } from '../repository/collection-canonical.repository';
import type {
  CanonicalContributorRow,
  CanonicalFailureStatus,
  CanonicalGenerationInventory,
  CanonicalLeaseToken,
} from '../collection-canonical.types';

const LEASE_MS = 10 * 60_000;
const HEARTBEAT_MS = 2 * 60_000;
const ORG_DEADLINE_MS = 45 * 60_000;

export interface CollectionReconciliationRuntime {
  appId: string;
  organizationLogin: string;
  tokens: CollectionAppTokenProvider;
  client: CollectionAppClient;
}

export type CollectionReconciliationRuntimeFactory = () =>
  CollectionReconciliationRuntime | Promise<CollectionReconciliationRuntime>;

class OrgDeadlineError extends Error {}

@Injectable()
export class CollectionReconciliationService {
  private readonly logger = new Logger(CollectionReconciliationService.name);
  constructor(
    private readonly repository: CollectionCanonicalRepository,
    private readonly runtimeFactory: CollectionReconciliationRuntimeFactory,
    private readonly now: () => Date = () => new Date(),
    private readonly createRunId: () => string = randomUUID,
  ) {}

  async trigger(
    ownerId: string,
  ): Promise<{ runId: string; status: 'PENDING' }> {
    let runtime: CollectionReconciliationRuntime;
    try {
      runtime = await this.runtimeFactory();
    } catch (error) {
      if (error instanceof CollectionAppConfigError) {
        throw new DomainException(
          COLLECTION_ERROR_CODES[
            CollectionErrorCode.COLLECTION_APP_UNAVAILABLE
          ],
        );
      }
      throw error;
    }
    const key = {
      appId: BigInt(runtime.appId),
      organizationLogin: runtime.organizationLogin,
    };
    const runId = this.createRunId();
    try {
      await runtime.tokens.getInstallationIdentity();
    } catch (error) {
      if (!(error instanceof CollectionAppTokenError)) throw error;
      const failedAt = this.now();
      await this.repository.appendPreflightFailure({
        ...key,
        runId,
        failedAt,
        errorClass: this.safeErrorClass(error),
        validity:
          error.safeReason === 'INSTALLATION'
            ? { installationValid: false, permissionsValid: false }
            : error.safeReason === 'PERMISSIONS'
              ? { installationValid: true, permissionsValid: false }
              : undefined,
      });
      throw error;
    }
    const now = this.now();
    await this.repository.createCandidate({
      ...key,
      runId,
      checkedAt: now,
    });
    const lease = await this.repository.acquireLease({
      ...key,
      ownerId,
      runId,
      now,
      expiresAt: new Date(now.getTime() + LEASE_MS),
    });
    if (!lease) {
      await this.repository.cleanupUnpublishedCandidate(runId);
      const active = await this.repository.getStatusSnapshot(key);
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.COLLECTION_RUN_IN_PROGRESS],
        { activeRunId: active?.runId ?? undefined },
      );
    }

    void this.reconcile(runtime, lease).catch((error: unknown) => {
      this.logger.error({
        event: 'collection.reconciliation.unhandled_failure',
        runId: lease.runId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    });
    return { runId, status: 'PENDING' };
  }

  triggerScheduled(
    ownerId: string,
  ): Promise<{ runId: string; status: 'PENDING' }> {
    return this.trigger(ownerId);
  }

  private async reconcile(
    runtime: CollectionReconciliationRuntime,
    lease: CanonicalLeaseToken,
  ): Promise<void> {
    const deadline = this.now().getTime() + ORG_DEADLINE_MS;
    try {
      await this.withHeartbeat(lease, async () => {
        await runtime.tokens.getToken();
        await this.repository.markValidity(lease, this.now(), {
          installationValid: true,
          permissionsValid: true,
        });
        const inventory = await this.collect(runtime, deadline);
        await this.repository.writeGeneration(lease, this.now, inventory, () =>
          this.heartbeat(lease),
        );
        await this.heartbeat(lease);
        await this.repository.completeAndPublish(lease, this.now());
      });
    } catch (error) {
      const status = this.failureStatus(error);
      try {
        await this.heartbeat(lease);
        await this.repository.finalizeFailure(
          lease,
          this.now(),
          status,
          this.safeErrorClass(error),
          this.validityForFailure(error),
        );
      } catch (finalizeError) {
        this.logger.warn({
          event: 'collection.reconciliation.finalize_failed',
          runId: lease.runId,
          errorName:
            finalizeError instanceof Error
              ? finalizeError.name
              : 'UnknownError',
        });
      }
    }
  }

  private async collect(
    runtime: CollectionReconciliationRuntime,
    deadline: number,
  ): Promise<CanonicalGenerationInventory> {
    const repositories = await this.beforeDeadline(
      runtime.client.listInstallationRepositories(),
      deadline,
    );
    const inventory: CanonicalGenerationInventory = {
      repositories: [],
      commits: [],
      pullRequests: [],
      releases: [],
      contributors: [],
    };
    for (const listed of repositories) {
      this.assertBeforeDeadline(deadline);
      const repository = await this.beforeDeadline(
        runtime.client.getRepository(listed.ownerLogin, listed.name),
        deadline,
      );
      if (
        repository.ownerLogin.toLowerCase() !==
          runtime.organizationLogin.toLowerCase() ||
        repository.id !== listed.id
      ) {
        throw new CollectionAppClientError('RESPONSE');
      }
      // rollback용 canonical generation은 legacy non-null branch schema다.
      // 활성 증분 수집은 빈 저장소를 정상 처리하지만, 이 구세대 경로는 빈
      // 문자열 sentinel을 쓰지 않고 명시적으로 실패해 잘못된 branch를 남기지 않는다.
      if (repository.defaultBranch === null) {
        throw new CollectionAppClientError('RESPONSE');
      }
      const repositoryId = BigInt(repository.id);
      inventory.repositories.push({
        githubRepositoryId: repositoryId,
        fullName: repository.fullName,
        visibility: repository.private ? 'private' : 'public',
        archived: repository.archived,
        defaultBranch: repository.defaultBranch,
      });
      const [commits, pullRequests, releases] = await Promise.all([
        this.beforeDeadline(
          runtime.client.listDefaultBranchCommits(
            repository.ownerLogin,
            repository.name,
            repository.defaultBranch,
          ),
          deadline,
        ),
        this.beforeDeadline(
          runtime.client.listPullRequests(
            repository.ownerLogin,
            repository.name,
          ),
          deadline,
        ),
        this.beforeDeadline(
          runtime.client.listPublishedReleases(
            repository.ownerLogin,
            repository.name,
          ),
          deadline,
        ),
      ]);
      this.appendResources(
        inventory,
        repositoryId,
        commits,
        pullRequests,
        releases,
      );
      if (!repository.private)
        inventory.contributors.push(
          ...this.contributors(
            repositoryId,
            commits,
            pullRequests,
            releases,
            this.now(),
          ),
        );
    }
    this.assertBeforeDeadline(deadline);
    return inventory;
  }

  private appendResources(
    inventory: CanonicalGenerationInventory,
    repositoryId: bigint,
    commits: CollectionCommit[],
    pullRequests: CollectionPullRequest[],
    releases: CollectionRelease[],
  ): void {
    inventory.commits.push(
      ...commits.map((commit) => ({
        githubRepositoryId: repositoryId,
        sha: commit.sha,
        committedAt: new Date(commit.committedAt),
        ...(commit.authorGithubId === null
          ? {}
          : {
              authorGithubId: BigInt(commit.authorGithubId),
              authorGithubLogin: commit.authorLogin!,
            }),
      })),
    );
    inventory.pullRequests.push(
      ...pullRequests.map((pullRequest) => ({
        githubRepositoryId: repositoryId,
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
    inventory.releases.push(
      ...releases.map((release) => ({
        githubRepositoryId: repositoryId,
        githubReleaseId: BigInt(release.id),
        publishedAt: new Date(release.publishedAt),
        authorGithubId:
          release.authorGithubId === null
            ? null
            : BigInt(release.authorGithubId),
        authorGithubLogin: release.authorLogin,
      })),
    );
  }

  private contributors(
    repositoryId: bigint,
    commits: CollectionCommit[],
    pullRequests: CollectionPullRequest[],
    releases: CollectionRelease[],
    projectedAt: Date,
  ): CanonicalContributorRow[] {
    const rows = new Map<string, CanonicalContributorRow>();
    const currentYear = Number(
      new Intl.DateTimeFormat('en', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
      }).format(projectedAt),
    );
    const currentYearStartsAt = new Date(`${currentYear}-01-01T00:00:00+09:00`);
    const nextYearStartsAt = new Date(
      `${currentYear + 1}-01-01T00:00:00+09:00`,
    );
    const add = (
      id: string | null,
      login: string | null,
      field: 'commitCount' | 'pullRequestCount' | 'releaseCount',
      occurredAt: string,
    ) => {
      if (id === null || login === null) return;
      const row = rows.get(id) ?? {
        githubRepositoryId: repositoryId,
        githubUserId: BigInt(id),
        githubLogin: login,
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
        currentYear,
        currentYearCommitCount: 0,
        currentYearPullRequestCount: 0,
        currentYearReleaseCount: 0,
      };
      row[field] += 1;
      const occurred = new Date(occurredAt);
      if (occurred >= currentYearStartsAt && occurred < nextYearStartsAt) {
        const currentYearField = {
          commitCount: 'currentYearCommitCount',
          pullRequestCount: 'currentYearPullRequestCount',
          releaseCount: 'currentYearReleaseCount',
        }[field] as
          | 'currentYearCommitCount'
          | 'currentYearPullRequestCount'
          | 'currentYearReleaseCount';
        row[currentYearField] += 1;
      }
      rows.set(id, row);
    };
    commits.forEach((item) =>
      add(
        item.authorGithubId,
        item.authorLogin,
        'commitCount',
        item.committedAt,
      ),
    );
    pullRequests.forEach((item) =>
      add(
        item.authorGithubId,
        item.authorLogin,
        'pullRequestCount',
        item.createdAt,
      ),
    );
    releases.forEach((item) =>
      add(
        item.authorGithubId,
        item.authorLogin,
        'releaseCount',
        item.publishedAt,
      ),
    );
    return [...rows.values()];
  }

  private async withHeartbeat<T>(
    token: CanonicalLeaseToken,
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
  private heartbeat(token: CanonicalLeaseToken): Promise<void> {
    const now = this.now();
    return this.repository.heartbeatLease(
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
    if (remaining <= 0) throw new OrgDeadlineError();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new OrgDeadlineError()), remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private assertBeforeDeadline(deadline: number): void {
    if (this.now().getTime() >= deadline) throw new OrgDeadlineError();
  }

  private failureStatus(error: unknown): CanonicalFailureStatus {
    if (error instanceof OrgDeadlineError) return 'INCOMPLETE';
    if (error instanceof CollectionAppTokenError) {
      if (
        error.safeReason === 'AUTH' ||
        error.safeReason === 'INSTALLATION' ||
        error.safeReason === 'PERMISSIONS'
      ) {
        return 'INCOMPLETE';
      }
    }
    if (error instanceof CollectionAppClientError) {
      if (error.kind === 'RATE_LIMITED') return 'RATE_LIMITED';
      if (
        error.kind === 'PAGINATION' ||
        error.kind === 'DEADLINE' ||
        error.kind === 'AUTH' ||
        error.kind === 'PERMISSION'
      )
        return 'INCOMPLETE';
    }
    return 'FAILED';
  }

  private validityForFailure(
    error: unknown,
  ): { installationValid: boolean; permissionsValid: boolean } | undefined {
    if (error instanceof CollectionAppTokenError) {
      if (error.safeReason === 'INSTALLATION') {
        return { installationValid: false, permissionsValid: false };
      }
      if (error.safeReason === 'PERMISSIONS') {
        return { installationValid: true, permissionsValid: false };
      }
    }
    return error instanceof CollectionAppClientError &&
      error.kind === 'PERMISSION'
      ? { installationValid: true, permissionsValid: false }
      : undefined;
  }
  private safeErrorClass(error: unknown): string {
    if (error instanceof CollectionAppClientError)
      return `COLLECTION_APP_${error.kind}`;
    if (error instanceof CollectionAppTokenError)
      return `COLLECTION_APP_${error.safeReason}`;
    if (error instanceof OrgDeadlineError) return 'COLLECTION_ORG_DEADLINE';
    return 'COLLECTION_FAILED';
  }
}
