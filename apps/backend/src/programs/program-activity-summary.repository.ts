import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ProgramRepositoryLink {
  readonly programId: string;
  readonly githubRepositoryId: bigint;
}

export interface CanonicalRepositoryActivityRecord {
  readonly githubRepositoryId: bigint;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly lastActivityAt: Date | null;
  readonly dataAsOf: Date;
}

interface CanonicalRepositoryActivityRow {
  readonly githubRepositoryId: bigint;
  readonly commitCount: bigint | number;
  readonly pullRequestCount: bigint | number;
  readonly releaseCount: bigint | number;
  readonly lastActivityAt: Date | null;
  readonly dataAsOf: Date;
}

export interface ProgramActivitySummaryDataSource {
  readonly repository: {
    findMany(args: {
      readonly where: {
        readonly programId: { readonly in: readonly string[] };
      };
      readonly select: {
        readonly programId: true;
        readonly githubRepositoryId: true;
      };
    }): Promise<readonly ProgramRepositoryLink[]>;
  };
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
}

@Injectable()
export class ProgramActivitySummaryRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: ProgramActivitySummaryDataSource,
  ) {}

  findRepositoryLinks(
    programIds: readonly string[],
  ): Promise<readonly ProgramRepositoryLink[]> {
    if (programIds.length === 0) return Promise.resolve([]);
    return this.prisma.repository.findMany({
      where: { programId: { in: [...programIds] } },
      select: { programId: true, githubRepositoryId: true },
    });
  }

  async findCanonicalActivity(
    repositoryIds: readonly bigint[],
  ): Promise<readonly CanonicalRepositoryActivityRecord[]> {
    if (repositoryIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      readonly CanonicalRepositoryActivityRow[]
    >(Prisma.sql`
      WITH active_repositories AS (
        SELECT
          repository."generationId",
          repository."githubRepositoryId",
          generation."finishedAt" AS "dataAsOf"
        FROM "CanonicalOrganizationState" state
        JOIN "CanonicalCollectionRun" generation
          ON generation."id" = state."activeGenerationId"
        JOIN "CanonicalRepository" repository
          ON repository."generationId" = generation."id"
        WHERE state."activeGenerationId" IS NOT NULL
          AND generation."status" = 'SUCCEEDED'::"CanonicalCollectionRunStatus"
          AND generation."finishedAt" IS NOT NULL
          AND repository."archived" = false
          AND repository."githubRepositoryId" IN (${Prisma.join([...repositoryIds])})
      ),
      latest_active_repositories AS (
        SELECT DISTINCT ON ("githubRepositoryId")
          "generationId",
          "githubRepositoryId",
          "dataAsOf"
        FROM active_repositories
        ORDER BY "githubRepositoryId", "dataAsOf" DESC
      )
      SELECT
        active."githubRepositoryId",
        (
          SELECT COUNT(*)
          FROM "CanonicalDefaultBranchCommit" commit
          WHERE commit."generationId" = active."generationId"
            AND commit."githubRepositoryId" = active."githubRepositoryId"
        ) AS "commitCount",
        (
          SELECT COUNT(*)
          FROM "CanonicalPullRequest" pull_request
          WHERE pull_request."generationId" = active."generationId"
            AND pull_request."githubRepositoryId" = active."githubRepositoryId"
        ) AS "pullRequestCount",
        (
          SELECT COUNT(*)
          FROM "CanonicalRelease" release
          WHERE release."generationId" = active."generationId"
            AND release."githubRepositoryId" = active."githubRepositoryId"
        ) AS "releaseCount",
        (
          SELECT MAX(activity."occurredAt")
          FROM (
            SELECT commit."committedAt" AS "occurredAt"
            FROM "CanonicalDefaultBranchCommit" commit
            WHERE commit."generationId" = active."generationId"
              AND commit."githubRepositoryId" = active."githubRepositoryId"
            UNION ALL
            SELECT pull_request."createdAt" AS "occurredAt"
            FROM "CanonicalPullRequest" pull_request
            WHERE pull_request."generationId" = active."generationId"
              AND pull_request."githubRepositoryId" = active."githubRepositoryId"
            UNION ALL
            SELECT release."publishedAt" AS "occurredAt"
            FROM "CanonicalRelease" release
            WHERE release."generationId" = active."generationId"
              AND release."githubRepositoryId" = active."githubRepositoryId"
          ) activity
        ) AS "lastActivityAt",
        active."dataAsOf"
      FROM latest_active_repositories active
      ORDER BY active."githubRepositoryId" ASC
    `);

    return rows.map((row) => ({
      githubRepositoryId: row.githubRepositoryId,
      commitCount: Number(row.commitCount),
      pullRequestCount: Number(row.pullRequestCount),
      releaseCount: Number(row.releaseCount),
      lastActivityAt: row.lastActivityAt,
      dataAsOf: row.dataAsOf,
    }));
  }
}
