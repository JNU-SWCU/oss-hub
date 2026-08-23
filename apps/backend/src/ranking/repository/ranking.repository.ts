import { Injectable } from '@nestjs/common';
import { AccountStatus, MemberKind, type Prisma } from '@prisma/client';
import { nextScheduledCollectionAt } from '../../github/collection-schedule';
import { PrismaService } from '../../prisma/prisma.service';
import {
  USER_PROFILE_DEPARTMENT_SELECT,
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileDepartment,
  resolveUserProfileName,
} from '../../profiles/user-profile-read';

export type RankingViewerClass = 'public' | 'staff';

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

export interface RankingMetricsQuery {
  readonly currentYear?: number;
}

/**
 * 순위에 오를 자격. canonical `UserProfile.memberKind`가 STUDENT인 사람만이다.
 *
 * 권한(`Role`)으로 가르지 않는다 — 관리자 권한은 회원 유형과 독립이라 학생 관리자는
 * 학생으로 남고, 반대로 `role`만 보면 교직원 관리자가 학생 순위에 섞인다. 프로필이
 * 없거나 유형이 아직 비어 있는 행은 학생임이 확정되지 않았으므로 함께 빠진다.
 */
const RANKING_ELIGIBLE_MEMBER: Prisma.UserWhereInput = {
  profile: { is: { memberKind: MemberKind.STUDENT } },
};

/**
 * Ranking read model. One query per screen question. Prisma stays here.
 *
 * Public rows never select name or studentId. Staff name is a separate
 * page-slice query so year-keyed public metrics cannot cache 실명.
 */
@Injectable()
export class RankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findViewerClass(githubId: bigint | null): Promise<RankingViewerClass> {
    if (githubId === null) {
      return 'public';
    }
    const actor = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
    if (
      actor !== null &&
      (actor.hasStaffAccess || actor.hasAdminAccess) &&
      actor.accountStatus === AccountStatus.ACTIVE
    ) {
      return 'staff';
    }
    return 'public';
  }

  async findMetrics(
    query: RankingMetricsQuery,
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
      this.prisma.githubUserActivityHistory.findMany({
        where:
          query.currentYear === undefined ? {} : { year: query.currentYear },
        select: {
          githubId: true,
          year: true,
          commitCount: true,
          pullRequestCount: true,
          issueCount: true,
          repositoryCount: true,
          starCount: true,
        },
      }),
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
    for (const row of activityRows) {
      const key = row.githubId.toString();
      const current = folded.get(key);
      if (current === undefined) {
        folded.set(key, {
          commitCount: row.commitCount,
          pullRequestCount: row.pullRequestCount,
          issueCount: row.issueCount,
          repositoryCount: row.repositoryCount,
          starCount: row.starCount,
          starYear: row.year,
        });
        continue;
      }
      current.commitCount += row.commitCount;
      current.pullRequestCount += row.pullRequestCount;
      current.issueCount += row.issueCount;
      current.repositoryCount += row.repositoryCount;
      if (row.year >= current.starYear) {
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
          department: resolveUserProfileDepartment(user),
          commitCount: totals?.commitCount ?? 0,
          pullRequestCount: totals?.pullRequestCount ?? 0,
          issueCount: totals?.issueCount ?? 0,
          repositoryCount: totals?.repositoryCount ?? 0,
          starCount: totals?.starCount ?? 0,
        };
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
    return new Map(
      users.map((user) => [user.githubId, resolveUserProfileName(user)]),
    );
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

  findNextCycleAt(from: Date): Date | null {
    return nextScheduledCollectionAt(from);
  }
}
