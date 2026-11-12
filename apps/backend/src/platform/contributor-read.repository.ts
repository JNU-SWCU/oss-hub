import { Injectable } from '@nestjs/common';
import { ActivityVisibility, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface StandingFilter {
  readonly year: number | null;
  readonly visibility: ActivityVisibility | null;
}

export interface StandingRow {
  readonly githubId: bigint;
  readonly year: number;
  readonly visibility: ActivityVisibility;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

interface StandingSqlRow {
  readonly githubId: bigint;
  readonly year: number;
  readonly visibility: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

const STANDING_COLUMNS = Prisma.raw(`
  github_id AS "githubId",
  year,
  visibility::text AS visibility,
  commit_count AS "commitCount",
  pull_request_count AS "pullRequestCount",
  issue_count AS "issueCount",
  repository_count AS "repositoryCount",
  star_count AS "starCount"
`);

function visibilityOf(value: string): ActivityVisibility {
  if (value === ActivityVisibility.PUBLIC) return ActivityVisibility.PUBLIC;
  if (value === ActivityVisibility.PRIVATE) return ActivityVisibility.PRIVATE;
  throw new Error(`Unexpected activity visibility: ${value}`);
}

function standingRow(row: StandingSqlRow): StandingRow {
  if (typeof row.githubId !== 'bigint') {
    throw new Error('Standing github id was not a bigint');
  }
  return {
    githubId: row.githubId,
    year: row.year,
    visibility: visibilityOf(row.visibility),
    commitCount: row.commitCount,
    pullRequestCount: row.pullRequestCount,
    issueCount: row.issueCount,
    repositoryCount: row.repositoryCount,
    starCount: row.starCount,
  };
}

async function selectStandingRows(
  prisma: PrismaService,
  filter: StandingFilter,
): Promise<readonly StandingRow[]> {
  const rows = await queryStandingRows(prisma, filter);
  return rows.map(standingRow);
}

async function queryStandingRows(
  prisma: PrismaService,
  filter: StandingFilter,
): Promise<readonly StandingSqlRow[]> {
  if (filter.year !== null && filter.visibility !== null) {
    return prisma.$queryRaw<StandingSqlRow[]>`
      SELECT ${STANDING_COLUMNS}
      FROM contributor_standing
      WHERE year = ${filter.year}
        AND visibility = ${filter.visibility}::"ActivityVisibility"
    `;
  }
  if (filter.year !== null) {
    return prisma.$queryRaw<StandingSqlRow[]>`
      SELECT ${STANDING_COLUMNS}
      FROM contributor_standing
      WHERE year = ${filter.year}
    `;
  }
  if (filter.visibility !== null) {
    return prisma.$queryRaw<StandingSqlRow[]>`
      SELECT ${STANDING_COLUMNS}
      FROM contributor_standing
      WHERE visibility = ${filter.visibility}::"ActivityVisibility"
    `;
  }
  return prisma.$queryRaw<StandingSqlRow[]>`
    SELECT ${STANDING_COLUMNS}
    FROM contributor_standing
  `;
}

async function selectStandingYears(
  prisma: PrismaService,
  filter: StandingFilter,
): Promise<readonly number[]> {
  const rows = await queryStandingYears(prisma, filter);
  return rows.map((row) => row.year).sort((left, right) => right - left);
}

async function queryStandingYears(
  prisma: PrismaService,
  filter: StandingFilter,
): Promise<readonly { readonly year: number }[]> {
  if (filter.year !== null) {
    throw new Error('Standing years do not take a year filter');
  }
  if (filter.visibility === null) {
    return prisma.$queryRaw<{ year: number }[]>`
      SELECT DISTINCT year FROM contributor_standing
    `;
  }
  return prisma.$queryRaw<{ year: number }[]>`
    SELECT DISTINCT year
    FROM contributor_standing
    WHERE visibility = ${filter.visibility}::"ActivityVisibility"
  `;
}

async function selectStandingObservedAt(
  prisma: PrismaService,
  filter: StandingFilter,
): Promise<Date | null> {
  const rows = await queryStandingObservedAt(prisma, filter);
  const row = rows[0];
  if (row === undefined) {
    throw new Error('Standing freshness query did not return a row');
  }
  return row.observedAt;
}

async function queryStandingObservedAt(
  prisma: PrismaService,
  filter: StandingFilter,
): Promise<readonly { readonly observedAt: Date | null }[]> {
  if (filter.year !== null) {
    throw new Error('Standing freshness does not take a year filter');
  }
  if (filter.visibility === null) {
    return prisma.$queryRaw<{ observedAt: Date | null }[]>`
      SELECT MAX(observed_at) AS "observedAt" FROM contributor_standing
    `;
  }
  return prisma.$queryRaw<{ observedAt: Date | null }[]>`
    SELECT MAX(observed_at) AS "observedAt"
    FROM contributor_standing
    WHERE visibility = ${filter.visibility}::"ActivityVisibility"
  `;
}

@Injectable()
export class ContributorReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  readStandingRows(filter: StandingFilter): Promise<readonly StandingRow[]> {
    return selectStandingRows(this.prisma, filter);
  }

  readStandingYears(filter: StandingFilter): Promise<readonly number[]> {
    return selectStandingYears(this.prisma, filter);
  }

  readStandingObservedAt(filter: StandingFilter): Promise<Date | null> {
    return selectStandingObservedAt(this.prisma, filter);
  }
}
