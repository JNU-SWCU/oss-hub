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

export interface CollectionSweepSnapshotRow {
  readonly snapshotDate: Date;
  readonly starCount: number;
}

export interface CollectionBackfillSnapshotRow {
  readonly githubId: bigint;
  readonly snapshotDate: Date;
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

  async hasAnySweepSnapshot(year: number): Promise<boolean> {
    const existing = await this.db.githubUserActivitySnapshot.findFirst({
      where: { year, source: GithubUserActivitySnapshotSource.SWEEP },
      select: { githubId: true },
    });
    return existing !== null;
  }

  async findLatestSweepSnapshot(
    githubId: bigint,
    year: number,
  ): Promise<CollectionSweepSnapshotRow | null> {
    return this.db.githubUserActivitySnapshot.findFirst({
      where: {
        githubId,
        year,
        source: GithubUserActivitySnapshotSource.SWEEP,
      },
      select: { snapshotDate: true, starCount: true },
      orderBy: { snapshotDate: 'desc' },
    });
  }

  async findSnapshotDates(githubId: bigint, year: number): Promise<Date[]> {
    const rows = await this.db.githubUserActivitySnapshot.findMany({
      where: { githubId, year },
      select: { snapshotDate: true },
      orderBy: { snapshotDate: 'asc' },
    });
    return rows.map((row) => row.snapshotDate);
  }

  async insertBackfillSnapshots(
    rows: readonly CollectionBackfillSnapshotRow[],
  ): Promise<number> {
    const inserted = await this.db.githubUserActivitySnapshot.createMany({
      data: rows.map((row) => ({
        ...row,
        source: GithubUserActivitySnapshotSource.BACKFILL,
        starEstimated: true,
      })),
      skipDuplicates: true,
    });
    return inserted.count;
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
