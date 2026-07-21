import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ObservationSourceType as PrismaObservationSourceType,
} from '@prisma/client';
import type { Prisma, User as PrismaUser } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { COLLECTION_RUN_STATUSES } from './domain/collection-run';
import type {
  CollectionRun,
  CollectionUser,
  ObservationSourceType,
  SuccessfulRunInput,
} from './domain/collection-run';
import { PrismaCollectionRunStartStore } from './collection-run-start.store';
import type { CollectionRunStartStore } from './collection-run-start.store';
import { toCollectionRun } from './collection-run.mapper';
import type { GithubObservation } from './domain/github-observation';

const FINALIZATION_TRANSACTION_TIMEOUT_MS = 30_000;

@Injectable()
export class CollectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByGithubId(githubId: bigint): Promise<CollectionUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId, accountStatus: AccountStatus.ACTIVE },
    });
    return user ? this.toUser(user) : null;
  }

  async withTransaction<T>(
    operation: (store: CollectionRunStartStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaCollectionRunStartStore(transaction)),
    );
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
    return this.prisma.$transaction(
      async (transaction) => {
        const transition = await transaction.collectionRun.updateMany({
          where: {
            id: input.runId,
            status: COLLECTION_RUN_STATUSES.RUNNING,
          },
          data: {
            status: COLLECTION_RUN_STATUSES.SUCCEEDED,
            profileCount: input.profiles.length,
            repoCount: input.repositories.length,
            eventCount: input.events.length,
            finishedAt: new Date(),
          },
        });
        if (transition.count === 1) {
          await transaction.githubRawObservation.createMany({
            data: observations,
          });
        }
        const run = await transaction.collectionRun.findUniqueOrThrow({
          where: { id: input.runId },
        });
        return toCollectionRun(run);
      },
      { timeout: FINALIZATION_TRANSACTION_TIMEOUT_MS },
    );
  }

  async markRateLimited(
    runId: string,
    retryNotBeforeAt: Date,
  ): Promise<CollectionRun> {
    return this.finalizeRunning(runId, {
      status: COLLECTION_RUN_STATUSES.RATE_LIMITED,
      retryNotBeforeAt,
      finishedAt: new Date(),
    });
  }

  async markFailed(runId: string): Promise<CollectionRun> {
    return this.finalizeRunning(runId, {
      status: COLLECTION_RUN_STATUSES.FAILED,
      finishedAt: new Date(),
    });
  }

  private async finalizeRunning(
    runId: string,
    data: Prisma.CollectionRunUpdateManyMutationInput,
  ): Promise<CollectionRun> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.collectionRun.updateMany({
          where: {
            id: runId,
            status: COLLECTION_RUN_STATUSES.RUNNING,
          },
          data,
        });
        const run = await transaction.collectionRun.findUniqueOrThrow({
          where: { id: runId },
        });
        return toCollectionRun(run);
      },
      { timeout: FINALIZATION_TRANSACTION_TIMEOUT_MS },
    );
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
}
