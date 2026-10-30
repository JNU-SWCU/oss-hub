import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  GithubUserActivitySnapshotSource,
} from '@prisma/client';
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

export interface CollectionUserActivitySnapshotTarget {
  readonly snapshotDate: Date;
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
    snapshot?: CollectionUserActivitySnapshotTarget,
  ): Promise<void> {
    const { githubId, year, ...row } = observation;
    const history = this.db.githubUserActivityHistory.upsert({
      where: { githubId_year: { githubId, year } },
      create: { githubId, year, ...row },
      update: row,
    });

    if (snapshot === undefined) {
      await history;
      return;
    }

    const snapshotRow = {
      year,
      ...row,
      source: GithubUserActivitySnapshotSource.SWEEP,
      starEstimated: false,
    };
    await this.db.$transaction([
      history,
      this.db.githubUserActivitySnapshot.upsert({
        where: {
          githubId_snapshotDate: {
            githubId,
            snapshotDate: snapshot.snapshotDate,
          },
        },
        create: {
          githubId,
          snapshotDate: snapshot.snapshotDate,
          ...snapshotRow,
        },
        update: snapshotRow,
      }),
    ]);
  }
}
