import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ActivityVisibility,
  UserType,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  USER_PROFILE_DEPARTMENT_SELECT,
  USER_PROFILE_NAME_SELECT,
} from '../platform/user-profile-read.config';

export type RankingRepositoryViewerClass = 'public' | 'member' | 'staff';

export interface RankingMetricRow {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly department: string | null;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export interface RankingMonthlySnapshotRow {
  readonly githubId: bigint;
  readonly month: number;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export interface RankingMetricsQuery {
  readonly currentYear?: number;
}

const RANKING_ELIGIBLE_MEMBER: Prisma.UserWhereInput = {
  type: UserType.STUDENT,
};

const ACTIVITY_SELECT = {
  githubId: true,
  year: true,
  visibility: true,
  commitCount: true,
  pullRequestCount: true,
  issueCount: true,
  repositoryCount: true,
  starCount: true,
} as const;

type ActivityRow = Prisma.GithubUserActivityHistoryGetPayload<{
  select: typeof ACTIVITY_SELECT;
}>;

function activityArgs(query: RankingMetricsQuery) {
  return {
    where: query.currentYear === undefined ? {} : { year: query.currentYear },
    select: ACTIVITY_SELECT,
  };
}

@Injectable()
export class RankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findViewerClass(
    githubId: bigint | null,
  ): Promise<RankingRepositoryViewerClass> {
    if (githubId === null) {
      return 'public';
    }
    const actor = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        ...USER_AUTHORITY_SELECT,
        accountStatus: true,
      },
    });
    if (actor === null || actor.accountStatus !== AccountStatus.ACTIVE) {
      return 'public';
    }
    if (
      actor.type === 'STAFF' &&
      actor.approvalStatus === 'APPROVED' &&
      actor.profileCreatedAt !== null &&
      actor.name !== null &&
      actor.department !== null
    ) {
      return 'staff';
    }
    return 'member';
  }

  async findMetrics(
    query: RankingMetricsQuery,
  ): Promise<readonly RankingMetricRow[]> {
    return this.foldMetrics(
      this.prisma.githubUserActivityHistory.findMany(activityArgs(query)),
    );
  }

  async findPreviousCycleMetrics(
    query: RankingMetricsQuery,
  ): Promise<readonly RankingMetricRow[]> {
    const rows = await this.prisma.githubUserActivityCycleSnapshot.findMany(
      activityArgs(query),
    );
    return rows.length === 0 ? [] : this.foldMetrics(Promise.resolve(rows));
  }

  private async foldMetrics(
    activity: Promise<readonly ActivityRow[]>,
  ): Promise<readonly RankingMetricRow[]> {
    const [users, activityRows] = await Promise.all([
      this.prisma.user.findMany({
        where: RANKING_ELIGIBLE_MEMBER,
        select: {
          githubId: true,
          nickname: true,
          ...USER_PROFILE_DEPARTMENT_SELECT,
        },
      }),
      activity,
    ]);

    const folded = new Map<
      string,
      {
        commitCount: number;
        pullRequestCount: number;
        issueCount: number;
        repositoryCount: number;
        starCount: number;
        starYear: number;
      }
    >();
    const NO_STAR_YEAR = Number.NEGATIVE_INFINITY;
    for (const row of activityRows) {
      const key = row.githubId.toString();
      const isPublic = row.visibility === ActivityVisibility.PUBLIC;
      const current = folded.get(key);
      if (current === undefined) {
        folded.set(key, {
          commitCount: row.commitCount,
          pullRequestCount: row.pullRequestCount,
          issueCount: row.issueCount,
          repositoryCount: row.repositoryCount,
          starCount: isPublic ? row.starCount : 0,
          starYear: isPublic ? row.year : NO_STAR_YEAR,
        });
        continue;
      }
      current.commitCount += row.commitCount;
      current.pullRequestCount += row.pullRequestCount;
      current.issueCount += row.issueCount;
      current.repositoryCount += row.repositoryCount;
      if (isPublic && row.year >= current.starYear) {
        current.starCount = row.starCount;
        current.starYear = row.year;
      }
    }

    return users
      .filter((user) => user.nickname)
      .map((user) => {
        const totals = folded.get(user.githubId.toString());
        return {
          githubId: user.githubId,
          githubLogin: user.nickname,
          department: user.department ?? null,
          commitCount: totals?.commitCount ?? 0,
          pullRequestCount: totals?.pullRequestCount ?? 0,
          issueCount: totals?.issueCount ?? 0,
          repositoryCount: totals?.repositoryCount ?? 0,
          starCount: totals?.starCount ?? 0,
        };
      });
  }

  async findMonthlySnapshots(
    year: number,
  ): Promise<readonly RankingMonthlySnapshotRow[]> {
    return this.prisma.githubUserActivityMonthly.findMany({
      where: { year },
      select: {
        githubId: true,
        month: true,
        commitCount: true,
        pullRequestCount: true,
        issueCount: true,
        repositoryCount: true,
        starCount: true,
      },
    });
  }

  async findNamesByGithubIds(
    githubIds: readonly bigint[],
  ): Promise<ReadonlyMap<bigint, string | null>> {
    const uniqueIds = [...new Set(githubIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const users = await this.prisma.user.findMany({
      where: { githubId: { in: uniqueIds } },
      select: {
        githubId: true,
        ...USER_PROFILE_NAME_SELECT,
      },
    });
    return new Map(users.map((user) => [user.githubId, user.name ?? null]));
  }

  async listYears(): Promise<readonly number[]> {
    const rows = await this.prisma.githubUserActivityHistory.findMany({
      select: { year: true },
      distinct: ['year'],
    });
    return rows.map((row) => row.year).sort((left, right) => right - left);
  }

  async findDataAsOf(): Promise<Date | null> {
    const latest = await this.prisma.githubUserActivityHistory.aggregate({
      _max: { observedAt: true },
    });
    return latest._max.observedAt ?? null;
  }
}
