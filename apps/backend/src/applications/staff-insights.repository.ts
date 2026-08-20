import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface StaffInsightsStudentRecord {
  readonly id: string;
  readonly githubId: bigint;
  readonly department: string | null;
}

export interface StaffInsightsParticipationRecord {
  readonly programId: string;
  readonly programName: string;
  readonly userIds: readonly string[];
}

export interface StaffInsightsActivityRecord {
  readonly githubId: bigint;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export interface StaffInsightsActivityQuery {
  readonly currentYear?: number;
}

@Injectable()
export class StaffInsightsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listStudents(): Promise<readonly StaffInsightsStudentRecord[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: 'STUDENT', accountStatus: 'ACTIVE' },
      select: {
        id: true,
        githubId: true,
        department: true,
        profile: { select: { department: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      githubId: row.githubId,
      department: row.profile?.department ?? row.department,
    }));
  }

  async listApprovedParticipations(): Promise<
    readonly StaffInsightsParticipationRecord[]
  > {
    const rows = await this.prisma.application.findMany({
      where: { status: 'APPROVED' },
      select: {
        programId: true,
        applicantId: true,
        program: { select: { name: true } },
        team: { select: { members: { select: { userId: true } } } },
      },
    });
    return rows.map((row) => {
      const memberIds = row.team.members.map((member) => member.userId);
      return {
        programId: row.programId,
        programName: row.program.name,
        userIds: [...new Set([row.applicantId, ...memberIds])],
      };
    });
  }

  /**
   * Person-axis activity totals. All-time folds commit/PR/issue/repo across
   * years and keeps star from the latest year (stars are snapshots, not
   * increments).
   */
  async listActivityTotals(
    query: StaffInsightsActivityQuery,
  ): Promise<readonly StaffInsightsActivityRecord[]> {
    const activityRows = await this.prisma.githubUserActivityHistory.findMany({
      where: query.currentYear === undefined ? {} : { year: query.currentYear },
      select: {
        githubId: true,
        year: true,
        commitCount: true,
        pullRequestCount: true,
        issueCount: true,
        repositoryCount: true,
        starCount: true,
      },
    });

    const folded = new Map<
      string,
      {
        commitCount: number;
        pullRequestCount: number;
        issueCount: number;
        repositoryCount: number;
        starCount: number;
        starYear: number;
        githubId: bigint;
      }
    >();
    for (const row of activityRows) {
      const key = row.githubId.toString();
      const current = folded.get(key);
      if (current === undefined) {
        folded.set(key, {
          githubId: row.githubId,
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

    return [...folded.values()].map((entry) => ({
      githubId: entry.githubId,
      commitCount: entry.commitCount,
      pullRequestCount: entry.pullRequestCount,
      issueCount: entry.issueCount,
      repositoryCount: entry.repositoryCount,
      starCount: entry.starCount,
    }));
  }

  async listActivityYears(): Promise<readonly number[]> {
    const rows = await this.prisma.githubUserActivityHistory.findMany({
      select: { year: true },
      distinct: ['year'],
    });
    return rows.map((row) => row.year).sort((left, right) => right - left);
  }

  async findActivityDataAsOf(): Promise<Date | null> {
    const latest = await this.prisma.githubUserActivityHistory.aggregate({
      _max: { observedAt: true },
    });
    return latest._max.observedAt ?? null;
  }
}
