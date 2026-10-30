import {
  CollectionAppClientError,
  type CollectionAppClient,
  type CollectionAppClientTokenProvider,
} from './collection-app.client';
import type { ProviderRequestQueue } from './collection-discovery.client';
import type {
  CollectionRepositoryRow,
  SyncLeaseToken,
} from './collection-incremental.types';
import type { CollectionIncrementalRepository } from './collection-incremental.repository';
import { splitNameWithOwner } from './github.policy';

export class RunDeadlineError extends Error {}

export class CollectionSyncDeadline {
  constructor(private readonly now: () => Date) {}

  async run<T>(operation: Promise<T>, deadline: number): Promise<T> {
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

export interface CollectionSyncRuntime {
  appId: string;
  organizationLogin: string;

  tokens: CollectionAppClientTokenProvider;
  client: CollectionAppClient;
  queue: ProviderRequestQueue;
}

export type CollectionSyncRuntimeFactory = () =>
  CollectionSyncRuntime | Promise<CollectionSyncRuntime>;

export interface SweepInventory {
  readonly complete: boolean;
  readonly repositories: readonly CollectionRepositoryRow[];
}

export class CollectionInventory {
  constructor(
    private readonly incrementalRepository: Pick<
      CollectionIncrementalRepository,
      | 'runInTransaction'
      | 'listPresentRepositories'
      | 'listExternalRepositories'
    >,
    private readonly deadline: CollectionSyncDeadline,
    private readonly now: () => Date,
  ) {}

  async org(
    runtime: CollectionSyncRuntime,
    lease: SyncLeaseToken,
    githubOrganizationId: bigint,
    deadline: number,
  ): Promise<SweepInventory> {
    let listed;
    try {
      listed = await this.deadline.run(
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

  async external(
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
        metadata = await this.deadline.run(
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
}
