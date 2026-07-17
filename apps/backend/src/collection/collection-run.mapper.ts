import type { CollectionRun as PrismaCollectionRun } from '@prisma/client';
import type { CollectionRun } from './domain/collection-run';

export function toCollectionRun(run: PrismaCollectionRun): CollectionRun {
  return {
    id: run.id,
    targetGithubId: run.targetGithubId,
    targetLogin: run.targetLogin,
    trigger: run.trigger,
    status: run.status,
    profileCount: run.profileCount,
    repoCount: run.repoCount,
    eventCount: run.eventCount,
    retryNotBeforeAt: run.retryNotBeforeAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}
