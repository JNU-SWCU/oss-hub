import { Injectable } from '@nestjs/common';
import {
  CollectionRunStatus,
  ObservationSourceType,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RankingObservation {
  readonly sourceId: string;
  readonly payload: Prisma.JsonValue;
  readonly targetLogin: string;
}

export interface RankingSourceData {
  readonly platformRepositoryIds: readonly string[];
  readonly observations: readonly RankingObservation[];
}

@Injectable()
export class RankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSourceData(): Promise<RankingSourceData> {
    const [repositories, observations] = await Promise.all([
      this.prisma.repository.findMany({
        select: { githubRepositoryId: true },
      }),
      this.prisma.githubRawObservation.findMany({
        where: {
          sourceType: ObservationSourceType.EVENT,
          run: { status: CollectionRunStatus.SUCCEEDED },
        },
        select: {
          sourceId: true,
          payload: true,
          run: { select: { targetLogin: true } },
        },
      }),
    ]);

    return {
      platformRepositoryIds: repositories.map((repository) =>
        repository.githubRepositoryId.toString(),
      ),
      observations: observations.map((observation) => ({
        sourceId: observation.sourceId,
        payload: observation.payload,
        targetLogin: observation.run.targetLogin,
      })),
    };
  }
}
