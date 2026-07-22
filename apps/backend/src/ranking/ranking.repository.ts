import { Injectable } from '@nestjs/common';
import {
  CollectionRunStatus,
  ObservationSourceType,
  RepositoryVisibility,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const RANKING_OBSERVATION_BATCH_SIZE = 500;

export interface RankingObservation {
  readonly id: string;
  readonly sourceId: string;
  readonly payload: Prisma.JsonValue;
  readonly targetGithubId: string;
  readonly targetLogin: string;
  readonly runId: string;
  readonly runStartedAt: Date;
}

@Injectable()
export class RankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async *findPlatformRepositoryIdBatches(): AsyncGenerator<readonly string[]> {
    let cursor: string | undefined;

    while (true) {
      const repositories = await this.prisma.repository.findMany({
        where: {
          visibility: RepositoryVisibility.PUBLIC,
          publishedAt: { not: null },
        },
        select: { id: true, githubRepositoryId: true },
        orderBy: { id: 'asc' },
        take: RANKING_OBSERVATION_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (repositories.length === 0) {
        return;
      }
      yield repositories.map((repository) =>
        repository.githubRepositoryId.toString(),
      );
      if (repositories.length < RANKING_OBSERVATION_BATCH_SIZE) {
        return;
      }
      cursor = repositories.at(-1)?.id;
    }
  }

  async *findObservationBatches(
    fetchedAtOrAfter?: Date,
  ): AsyncGenerator<readonly RankingObservation[]> {
    let cursor: string | undefined;

    while (true) {
      const observations = await this.prisma.githubRawObservation.findMany({
        where: {
          sourceType: ObservationSourceType.EVENT,
          run: { status: CollectionRunStatus.SUCCEEDED },
          ...(fetchedAtOrAfter ? { fetchedAt: { gte: fetchedAtOrAfter } } : {}),
        },
        select: {
          id: true,
          sourceId: true,
          payload: true,
          run: {
            select: {
              id: true,
              targetGithubId: true,
              targetLogin: true,
              startedAt: true,
            },
          },
        },
        orderBy: [{ sourceId: 'asc' }, { id: 'asc' }],
        take: RANKING_OBSERVATION_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (observations.length === 0) {
        return;
      }

      yield observations.map((observation) => ({
        id: observation.id,
        sourceId: observation.sourceId,
        payload: observation.payload,
        targetGithubId: observation.run.targetGithubId.toString(),
        targetLogin: observation.run.targetLogin,
        runId: observation.run.id,
        runStartedAt: observation.run.startedAt,
      }));

      if (observations.length < RANKING_OBSERVATION_BATCH_SIZE) {
        return;
      }
      cursor = observations.at(-1)?.id;
    }
  }
}
