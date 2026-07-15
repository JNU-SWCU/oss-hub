import { Injectable } from '@nestjs/common';
import {
  CollectionRun as PrismaCollectionRun,
  ObservationSourceType as PrismaObservationSourceType,
  Prisma,
  User as PrismaUser,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COLLECTION_RUN_STATUSES,
  CollectionRun,
  CollectionTrigger,
  CollectionUser,
  ObservationSourceType,
  SuccessfulRunInput,
} from './domain/collection-run';
import { GithubObservation } from './domain/github-observation';

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
  hasActiveRun(githubId: bigint): Promise<boolean>;
  findLatestRun(githubId: bigint): Promise<CollectionRunRetryState | null>;
  createRun(
    user: CollectionUser,
    trigger: CollectionTrigger,
  ): Promise<CollectionRun>;
}

@Injectable()
export class CollectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByGithubId(githubId: bigint): Promise<CollectionUser | null> {
    const user = await this.prisma.user.findUnique({ where: { githubId } });
    return user ? this.toUser(user) : null;
  }

  async withTransaction<T>(
    operation: (store: CollectionRunStartStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      const store: CollectionRunStartStore = {
        getDatabaseTime: async () => {
          const clockRows = await transaction.$queryRaw<DatabaseClockRow[]>`
            SELECT CURRENT_TIMESTAMP AS "now"
          `;
          const now = clockRows[0]?.now;
          if (!now) {
            throw new MissingDatabaseClockError();
          }
          return now;
        },
        tryAcquireUserLock: async (githubId) => {
          const lockRows = await transaction.$queryRaw<AdvisoryLockRow[]>`
            SELECT pg_try_advisory_xact_lock(${githubId}) AS "locked"
          `;
          const locked = lockRows[0]?.locked;
          if (locked === undefined) {
            throw new MissingAdvisoryLockResultError();
          }
          return locked;
        },
        hasActiveRun: async (targetGithubId) => {
          const activeRun = await transaction.collectionRun.findFirst({
            where: {
              targetGithubId,
              status: COLLECTION_RUN_STATUSES.RUNNING,
            },
            select: { id: true },
          });
          return activeRun !== null;
        },
        findLatestRun: (targetGithubId) =>
          transaction.collectionRun.findFirst({
            where: { targetGithubId },
            orderBy: { startedAt: 'desc' },
            select: { retryNotBeforeAt: true, startedAt: true },
          }),
        createRun: async (user, trigger) => {
          const run = await transaction.collectionRun.create({
            data: {
              targetGithubId: user.githubId,
              targetLogin: user.login,
              trigger,
              status: COLLECTION_RUN_STATUSES.RUNNING,
            },
          });
          return this.toRun(run);
        },
      };
      return operation(store);
    });
  }

  async markSucceeded(input: SuccessfulRunInput): Promise<CollectionRun> {
    const observations = [
      ...this.toObservationRows(
        input.runId,
        PrismaObservationSourceType.PROFILE,
        input.profiles,
      ),
      ...this.toObservationRows(
        input.runId,
        PrismaObservationSourceType.REPO,
        input.repositories,
      ),
      ...this.toObservationRows(
        input.runId,
        PrismaObservationSourceType.EVENT,
        input.events,
      ),
    ];
    const [, run] = await this.prisma.$transaction([
      this.prisma.githubRawObservation.createMany({ data: observations }),
      this.prisma.collectionRun.update({
        where: { id: input.runId },
        data: {
          status: COLLECTION_RUN_STATUSES.SUCCEEDED,
          profileCount: input.profiles.length,
          repoCount: input.repositories.length,
          eventCount: input.events.length,
          finishedAt: new Date(),
        },
      }),
    ]);
    return this.toRun(run);
  }

  async markRateLimited(
    runId: string,
    retryNotBeforeAt: Date,
  ): Promise<CollectionRun> {
    const run = await this.prisma.collectionRun.update({
      where: { id: runId },
      data: {
        status: COLLECTION_RUN_STATUSES.RATE_LIMITED,
        retryNotBeforeAt,
        finishedAt: new Date(),
      },
    });
    return this.toRun(run);
  }

  async markFailed(runId: string): Promise<CollectionRun> {
    const run = await this.prisma.collectionRun.update({
      where: { id: runId },
      data: {
        status: COLLECTION_RUN_STATUSES.FAILED,
        finishedAt: new Date(),
      },
    });
    return this.toRun(run);
  }

  private toObservationRows(
    runId: string,
    sourceType: ObservationSourceType,
    observations: GithubObservation[],
  ): Prisma.GithubRawObservationCreateManyInput[] {
    return observations.map((observation) => ({
      runId,
      sourceType,
      sourceId: observation.sourceId,
      payload: observation.payload,
    }));
  }

  private toUser(user: PrismaUser): CollectionUser {
    return {
      githubId: user.githubId,
      login: user.login,
    };
  }

  private toRun(run: PrismaCollectionRun): CollectionRun {
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
}
