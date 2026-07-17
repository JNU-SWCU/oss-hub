import type { Prisma } from '@prisma/client';
import { COLLECTION_RUN_STATUSES } from './domain/collection-run';
import type {
  CollectionRun,
  CollectionTrigger,
  CollectionUser,
} from './domain/collection-run';
import { toCollectionRun } from './collection-run.mapper';

type DatabaseClockRow = {
  readonly now: Date;
};

type AdvisoryLockRow = {
  readonly locked: boolean;
};

class MissingDatabaseClockError extends Error {
  override readonly name = 'MissingDatabaseClockError';

  constructor() {
    super('Database did not return its current time');
  }
}

class MissingAdvisoryLockResultError extends Error {
  override readonly name = 'MissingAdvisoryLockResultError';

  constructor() {
    super('Database did not return the advisory lock result');
  }
}

export type CollectionRunRetryState = Readonly<
  Pick<CollectionRun, 'retryNotBeforeAt' | 'startedAt'>
>;

export interface CollectionRunStartStore {
  getDatabaseTime(): Promise<Date>;
  tryAcquireUserLock(githubId: bigint): Promise<boolean>;
  recoverStaleRun(
    githubId: bigint,
    staleBeforeAt: Date,
    finishedAt: Date,
  ): Promise<void>;
  hasActiveRun(githubId: bigint): Promise<boolean>;
  findLatestRun(githubId: bigint): Promise<CollectionRunRetryState | null>;
  createRun(
    user: CollectionUser,
    trigger: CollectionTrigger,
  ): Promise<CollectionRun>;
}

export class PrismaCollectionRunStartStore implements CollectionRunStartStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async getDatabaseTime(): Promise<Date> {
    const clockRows = await this.transaction.$queryRaw<DatabaseClockRow[]>`
      SELECT CURRENT_TIMESTAMP AS "now"
    `;
    const now = clockRows[0]?.now;
    if (!now) {
      throw new MissingDatabaseClockError();
    }
    return now;
  }

  async tryAcquireUserLock(githubId: bigint): Promise<boolean> {
    const lockRows = await this.transaction.$queryRaw<AdvisoryLockRow[]>`
      SELECT pg_try_advisory_xact_lock(${githubId}) AS "locked"
    `;
    const locked = lockRows[0]?.locked;
    if (locked === undefined) {
      throw new MissingAdvisoryLockResultError();
    }
    return locked;
  }

  async recoverStaleRun(
    targetGithubId: bigint,
    staleBeforeAt: Date,
    finishedAt: Date,
  ): Promise<void> {
    await this.transaction.collectionRun.updateMany({
      where: {
        targetGithubId,
        status: COLLECTION_RUN_STATUSES.RUNNING,
        startedAt: { lte: staleBeforeAt },
      },
      data: {
        status: COLLECTION_RUN_STATUSES.FAILED,
        finishedAt,
      },
    });
  }

  async hasActiveRun(targetGithubId: bigint): Promise<boolean> {
    const activeRun = await this.transaction.collectionRun.findFirst({
      where: {
        targetGithubId,
        status: COLLECTION_RUN_STATUSES.RUNNING,
      },
      select: { id: true },
    });
    return activeRun !== null;
  }

  findLatestRun(
    targetGithubId: bigint,
  ): Promise<CollectionRunRetryState | null> {
    return this.transaction.collectionRun.findFirst({
      where: { targetGithubId },
      orderBy: { startedAt: 'desc' },
      select: { retryNotBeforeAt: true, startedAt: true },
    });
  }

  async createRun(
    user: CollectionUser,
    trigger: CollectionTrigger,
  ): Promise<CollectionRun> {
    const run = await this.transaction.collectionRun.create({
      data: {
        targetGithubId: user.githubId,
        targetLogin: user.login,
        trigger,
        status: COLLECTION_RUN_STATUSES.RUNNING,
      },
    });
    return toCollectionRun(run);
  }
}
