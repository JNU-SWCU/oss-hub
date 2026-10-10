import { Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface CollectionActivityUserRow {
  readonly githubId: bigint;
  readonly nickname: string;
}

export interface CollectionUserActivityObservationInput {
  readonly githubId: bigint;
  readonly year: number;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly observedAt: Date;
}

@Injectable()
export class CollectionUserActivityRepository {
  constructor(private readonly db: PrismaService) {}

  async listActiveUsers(): Promise<CollectionActivityUserRow[]> {
    return this.db.user.findMany({
      where: { accountStatus: AccountStatus.ACTIVE },
      select: { githubId: true, nickname: true },
      orderBy: { githubId: 'asc' },
    });
  }

  async hasObservation(githubId: bigint, year: number): Promise<boolean> {
    const existing = await this.db.githubUserActivityHistory.findUnique({
      where: { githubId_year: { githubId, year } },
      select: { githubId: true },
    });
    return existing !== null;
  }

  async upsertObservation(
    observation: CollectionUserActivityObservationInput,
  ): Promise<void> {
    const { githubId, year, ...row } = observation;
    await this.db.githubUserActivityHistory.upsert({
      where: { githubId_year: { githubId, year } },
      create: { githubId, year, ...row },
      update: row,
    });
  }
}
