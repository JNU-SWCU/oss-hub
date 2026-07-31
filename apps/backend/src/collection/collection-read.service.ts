import { Injectable } from '@nestjs/common';
import { CanonicalCollectionRunStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionCanonicalRepository } from './collection-canonical.repository';
import type {
  CollectionRankingActivityDto,
  CollectionRankingActivityQueryDto,
  CollectionReadPort,
  CollectionRepositoryActivityDto,
  CollectionRepositoryActivityQueryDto,
  CollectionStatusSnapshotDto,
} from './collection-read.port';

@Injectable()
export class CollectionReadService implements CollectionReadPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly canonicalRepository: CollectionCanonicalRepository,
  ) {}

  async findRepositoryActivity(
    query: CollectionRepositoryActivityQueryDto,
  ): Promise<readonly CollectionRepositoryActivityDto[]> {
    if (query.repositoryIds.length === 0) return [];

    const authorWhere = query.authorGithubId
      ? { authorGithubId: query.authorGithubId }
      : undefined;
    const generations = await this.prisma.canonicalOrganizationState.findMany({
      where: {
        activeGenerationId: { not: null },
        activeGeneration: {
          status: CanonicalCollectionRunStatus.SUCCEEDED,
          repositories: {
            some: { githubRepositoryId: { in: [...query.repositoryIds] } },
          },
        },
      },
      select: {
        activeGeneration: {
          select: {
            finishedAt: true,
            repositories: {
              where: { githubRepositoryId: { in: [...query.repositoryIds] } },
              select: {
                githubRepositoryId: true,
                commits: {
                  where: authorWhere,
                  select: { committedAt: true },
                },
                pullRequests: {
                  where: authorWhere,
                  select: { createdAt: true },
                },
                releases: {
                  where: authorWhere,
                  select: { publishedAt: true },
                },
              },
            },
          },
        },
      },
    });

    return generations.flatMap((generation) => {
      const activeGeneration = generation.activeGeneration;
      const dataAsOf = activeGeneration?.finishedAt;
      if (!activeGeneration || !dataAsOf) return [];
      return activeGeneration.repositories.map((repository) => ({
        repositoryId: repository.githubRepositoryId,
        dataAsOf,
        commitDates: repository.commits.map((commit) => commit.committedAt),
        pullRequestDates: repository.pullRequests.map(
          (pullRequest) => pullRequest.createdAt,
        ),
        releaseDates: repository.releases.map((release) => release.publishedAt),
      }));
    });
  }

  async findRankingActivity(
    query: CollectionRankingActivityQueryDto,
  ): Promise<readonly CollectionRankingActivityDto[]> {
    const projections =
      await this.prisma.canonicalContributorProjection.findMany({
        where: {
          generation: { activeFor: { some: {} } },
          ...(query.currentYear === undefined
            ? {}
            : { currentYear: query.currentYear }),
        },
        select: {
          githubUserId: true,
          githubLogin: true,
          commitCount: true,
          pullRequestCount: true,
          releaseCount: true,
          currentYearCommitCount: true,
          currentYearPullRequestCount: true,
          currentYearReleaseCount: true,
        },
      });

    const activity = new Map<string, CollectionRankingActivityDto>();
    for (const row of projections) {
      const key = row.githubUserId.toString();
      const current = activity.get(key);
      const githubLogin =
        !current ||
        row.githubLogin.normalize().toLocaleLowerCase('en-US') <
          current.githubLogin.normalize().toLocaleLowerCase('en-US')
          ? row.githubLogin
          : current.githubLogin;
      const commitCount =
        query.currentYear === undefined
          ? row.commitCount
          : row.currentYearCommitCount;
      const prCount =
        query.currentYear === undefined
          ? row.pullRequestCount
          : row.currentYearPullRequestCount;
      const releaseCount =
        query.currentYear === undefined
          ? row.releaseCount
          : row.currentYearReleaseCount;
      activity.set(key, {
        githubId: row.githubUserId,
        githubLogin,
        commitCount: (current?.commitCount ?? 0) + commitCount,
        prCount: (current?.prCount ?? 0) + prCount,
        releaseCount: (current?.releaseCount ?? 0) + releaseCount,
      });
    }
    return [...activity.values()];
  }

  async getStatusSnapshot(): Promise<CollectionStatusSnapshotDto | null> {
    const keys = await this.prisma.$queryRawUnsafe<
      Array<{ appId: bigint; organizationLogin: string }>
    >(
      `SELECT "appId", "organizationLogin" FROM "CanonicalOrganizationState" ORDER BY "updatedAt" DESC LIMIT 1`,
    );
    const key = keys[0];
    if (!key) return null;

    const canonical = await this.canonicalRepository.getStatusSnapshot(key);
    if (!canonical) return null;

    const timestamps = await this.prisma.$queryRawUnsafe<
      Array<{
        lastCompleteSuccessAt: Date | null;
        dataAsOf: Date | null;
      }>
    >(
      `SELECT
         MAX(r."finishedAt") FILTER (WHERE r."status" = 'SUCCEEDED') AS "lastCompleteSuccessAt",
         active."finishedAt" AS "dataAsOf"
       FROM "CanonicalOrganizationState" s
       LEFT JOIN "CanonicalCollectionRun" r
         ON r."appId" = s."appId" AND r."organizationLogin" = s."organizationLogin"
       LEFT JOIN "CanonicalCollectionRun" active ON active."id" = s."activeGenerationId"
       WHERE s."appId" = $1 AND s."organizationLogin" = $2
       GROUP BY active."finishedAt"`,
      key.appId,
      key.organizationLogin,
    );

    return {
      installationValid: canonical.installationValid,
      permissionsValid: canonical.permissionsValid,
      runStatus: canonical.runStatus,
      lastCompleteSuccessAt: timestamps[0]?.lastCompleteSuccessAt ?? null,
      dataAsOf: timestamps[0]?.dataAsOf ?? null,
    };
  }
}
