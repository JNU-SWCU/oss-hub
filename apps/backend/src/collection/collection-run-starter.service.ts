import { Injectable } from '@nestjs/common';
import { CollectionRepository } from './collection.repository';
import {
  COLLECTION_RUN_COOLDOWN_MS,
  COLLECTION_RUN_STALE_AFTER_MS,
  COLLECTION_RUN_START_KINDS,
} from './domain/collection-run';
import type {
  CollectionRunStartResult,
  CollectionTrigger,
  CollectionUser,
} from './domain/collection-run';

@Injectable()
export class CollectionRunStarter {
  constructor(private readonly repository: CollectionRepository) {}

  async start(
    user: CollectionUser,
    trigger: CollectionTrigger,
  ): Promise<CollectionRunStartResult> {
    return this.repository.withTransaction<CollectionRunStartResult>(
      async (store) => {
        const now = await store.getDatabaseTime();
        if (!(await store.tryAcquireUserLock(user.githubId))) {
          return {
            kind: COLLECTION_RUN_START_KINDS.REJECTED,
            retryNotBeforeAt: new Date(
              now.getTime() + COLLECTION_RUN_COOLDOWN_MS,
            ),
          };
        }
        await store.recoverStaleRun(
          user.githubId,
          new Date(now.getTime() - COLLECTION_RUN_STALE_AFTER_MS),
          now,
        );
        if (await store.hasActiveRun(user.githubId)) {
          return {
            kind: COLLECTION_RUN_START_KINDS.REJECTED,
            retryNotBeforeAt: new Date(
              now.getTime() + COLLECTION_RUN_COOLDOWN_MS,
            ),
          };
        }

        const latestRun = await store.findLatestRun(user.githubId);
        if (latestRun) {
          const cooldownRetryAt = new Date(
            latestRun.startedAt.getTime() + COLLECTION_RUN_COOLDOWN_MS,
          );
          const retryNotBeforeAt =
            latestRun.retryNotBeforeAt &&
            latestRun.retryNotBeforeAt > cooldownRetryAt
              ? latestRun.retryNotBeforeAt
              : cooldownRetryAt;
          if (retryNotBeforeAt > now) {
            return {
              kind: COLLECTION_RUN_START_KINDS.REJECTED,
              retryNotBeforeAt,
            };
          }
        }

        return {
          kind: COLLECTION_RUN_START_KINDS.STARTED,
          run: await store.createRun(user, trigger),
        };
      },
    );
  }
}
