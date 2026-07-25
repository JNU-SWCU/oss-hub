import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CanonicalRankingActivity {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly prCount: number;
  readonly releaseCount: number;
}

@Injectable()
export class RankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findCanonicalActivity(
    currentYear?: number,
  ): Promise<readonly CanonicalRankingActivity[]> {
    const projections =
      await this.prisma.canonicalContributorProjection.findMany({
        where: {
          generation: { activeFor: { some: {} } },
          ...(currentYear === undefined ? {} : { currentYear }),
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

    const activity = new Map<string, CanonicalRankingActivity>();
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
        currentYear === undefined
          ? row.commitCount
          : row.currentYearCommitCount;
      const prCount =
        currentYear === undefined
          ? row.pullRequestCount
          : row.currentYearPullRequestCount;
      const releaseCount =
        currentYear === undefined
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
}
