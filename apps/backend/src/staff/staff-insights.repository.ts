import { Injectable } from '@nestjs/common';
import {
  ActivityVisibility,
  ProgramLifecycle,
  type ProgramCategory,
} from '@prisma/client';
import {
  ContributorReadRepository,
  type StandingRow,
} from '../platform/contributor-read.repository';
import { PrismaService } from '../platform/prisma.service';
import {
  STUDENT_MEMBER_WHERE,
  USER_PROFILE_DEPARTMENT_SELECT,
  USER_PROFILE_NAME_SELECT,
} from '../platform/user-profile-read.config';

export interface StaffInsightsStudentRecord {
  readonly id: string;
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly department: string | null;
}

export interface StaffInsightsParticipationRecord {
  readonly programId: string;
  readonly programName: string;
  readonly userIds: readonly string[];
}

export interface StaffInsightsProgramRecord {
  readonly id: string;
  readonly name: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly startAt: Date;
  readonly endAt: Date;
}

export interface StaffInsightsApplicationCountRecord {
  readonly programId: string;
  readonly appliedCount: number;
  readonly approvedCount: number;
}

export interface StaffInsightsCompletionRecord {
  readonly programId: string;
  readonly dueRequirementCount: number;
  readonly submittedRequirementCount: number;
}

export interface StaffInsightsOutcomeRecord {
  readonly programId: string;
  readonly repoTeamCount: number;
  readonly activeTeamCount: number;
  readonly contributionCount: number;
}

export interface StaffInsightsActivityRecord {
  readonly githubId: bigint;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export interface StaffInsightsBaselineRecord {
  readonly githubId: bigint;
  readonly year: number;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
}

export interface StaffInsightsActivityQuery {
  readonly currentYear?: number;
}

function toBaselineRecord(row: StandingRow): StaffInsightsBaselineRecord {
  return {
    githubId: row.githubId,
    year: row.year,
    commitCount: row.commitCount,
    pullRequestCount: row.pullRequestCount,
    issueCount: row.issueCount,
    repositoryCount: row.repositoryCount,
  };
}

@Injectable()
export class StaffInsightsRepository {
  private readonly contributors: ContributorReadRepository;

  constructor(private readonly prisma: PrismaService) {
    this.contributors = new ContributorReadRepository(prisma);
  }

  async listStudents(): Promise<readonly StaffInsightsStudentRecord[]> {
    const rows = await this.prisma.user.findMany({
      where: { ...STUDENT_MEMBER_WHERE, accountStatus: 'ACTIVE' },
      select: {
        id: true,
        githubId: true,
        nickname: true,
        ...USER_PROFILE_NAME_SELECT,
        ...USER_PROFILE_DEPARTMENT_SELECT,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      githubId: row.githubId,
      githubLogin: row.nickname,
      name: row.name ?? null,
      department: row.department ?? null,
    }));
  }

  async listApprovedParticipations(): Promise<
    readonly StaffInsightsParticipationRecord[]
  > {
    const rows = await this.prisma.team.findMany({
      where: { status: 'APPROVED', archivedAt: null },
      select: {
        programId: true,
        applicantId: true,
        program: { select: { name: true } },
        members: { select: { userId: true } },
      },
    });
    return rows.map((row) => {
      const memberIds = row.members.map((member) => member.userId);
      return {
        programId: row.programId,
        programName: row.program.name,
        userIds: [...new Set([row.applicantId, ...memberIds])],
      };
    });
  }

  async listPublishedPrograms(): Promise<
    readonly StaffInsightsProgramRecord[]
  > {
    return this.prisma.program.findMany({
      where: { lifecycle: ProgramLifecycle.PUBLISHED },
      select: {
        id: true,
        name: true,
        category: true,
        applicationStartAt: true,
        applicationEndAt: true,
        startAt: true,
        endAt: true,
      },
    });
  }

  async listProgramApplicationCounts(): Promise<
    readonly StaffInsightsApplicationCountRecord[]
  > {
    const rows = await this.prisma.team.groupBy({
      by: ['programId', 'status'],
      where: {
        archivedAt: null,
        program: { lifecycle: ProgramLifecycle.PUBLISHED },
      },
      _count: { _all: true },
    });
    const byProgram = new Map<
      string,
      { appliedCount: number; approvedCount: number }
    >();
    for (const row of rows) {
      const current = byProgram.get(row.programId) ?? {
        appliedCount: 0,
        approvedCount: 0,
      };
      current.appliedCount += row._count._all;
      if (row.status === 'APPROVED') current.approvedCount += row._count._all;
      byProgram.set(row.programId, current);
    }
    return [...byProgram.entries()].map(([programId, counts]) => ({
      programId,
      ...counts,
    }));
  }

  async listProgramCompletion(
    now: Date,
  ): Promise<readonly StaffInsightsCompletionRecord[]> {
    return this.prisma.$queryRaw<StaffInsightsCompletionRecord[]>`
      SELECT
        team."programId" AS "programId",
        COUNT(*)::int AS "dueRequirementCount",
        COUNT(submission.id) FILTER (
          WHERE submission.status <> 'REJECTED'
        )::int AS "submittedRequirementCount"
      FROM "Team" AS team
      JOIN "Program" AS program ON program.id = team."programId"
      JOIN "Milestone" AS milestone ON milestone."programId" = team."programId"
      JOIN "Requirement" AS requirement
        ON requirement."milestoneId" = milestone.id
      LEFT JOIN "Submission" AS submission
        ON submission."requirementId" = requirement.id
        AND submission."teamId" = team.id
      WHERE team.status = 'APPROVED'
        AND team."archivedAt" IS NULL
        AND program.lifecycle = 'PUBLISHED'
        AND requirement.required = true
        AND milestone."dueAt" <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY team."programId"
    `;
  }

  async listProgramOutcomes(
    now: Date,
  ): Promise<readonly StaffInsightsOutcomeRecord[]> {
    return this.prisma.$queryRaw<StaffInsightsOutcomeRecord[]>`
      WITH linked AS (
        SELECT
          team."programId" AS program_id,
          team.id AS team_id,
          link.repo_id,
          link.valid_from,
          link.valid_to,
          program."startAt" AT TIME ZONE 'UTC' AS window_start,
          LEAST(
            program."endAt" AT TIME ZONE 'UTC',
            ${now.toISOString()}::timestamptz
          ) AS window_end
        FROM "Team" AS team
        JOIN "Program" AS program ON program.id = team."programId"
        JOIN "team_repo" AS link ON link.team_id = team.id
        WHERE team.status = 'APPROVED'
          AND team."archivedAt" IS NULL
          AND program.lifecycle = 'PUBLISHED'
      ),
      matched AS (
        SELECT DISTINCT
          linked.program_id,
          linked.team_id,
          event.repo_id,
          event.kind,
          event.github_key
        FROM linked
        JOIN "contribution" AS event ON event.repo_id = linked.repo_id
        WHERE event.kind IN (
            'commit'::"contribution_kind",
            'pull_request'::"contribution_kind",
            'issue'::"contribution_kind"
          )
          AND event.occurred_at >= linked.window_start
          AND event.occurred_at < linked.window_end
          AND event.occurred_at >= linked.valid_from
          AND (linked.valid_to IS NULL OR event.occurred_at < linked.valid_to)
      )
      SELECT
        program_id AS "programId",
        repo_teams.repo_team_count AS "repoTeamCount",
        COALESCE(active_teams.active_team_count, 0)::int AS "activeTeamCount",
        COALESCE(events.contribution_count, 0)::int AS "contributionCount"
      FROM (
        SELECT program_id, COUNT(DISTINCT team_id)::int AS repo_team_count
        FROM linked
        GROUP BY program_id
      ) AS repo_teams
      LEFT JOIN (
        SELECT program_id, COUNT(DISTINCT team_id)::int AS active_team_count
        FROM matched
        GROUP BY program_id
      ) AS active_teams USING (program_id)
      LEFT JOIN (
        SELECT program_id, COUNT(*)::int AS contribution_count
        FROM (
          SELECT DISTINCT program_id, repo_id, kind, github_key FROM matched
        ) AS distinct_events
        GROUP BY program_id
      ) AS events USING (program_id)
    `;
  }

  async listActivityTotals(
    query: StaffInsightsActivityQuery,
  ): Promise<readonly StaffInsightsActivityRecord[]> {
    const activityRows = await this.contributors.readStandingRows({
      year: query.currentYear ?? null,
      visibility: ActivityVisibility.PUBLIC,
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

  async listActivityBaselines(
    year: number,
    before: Date,
  ): Promise<readonly StaffInsightsBaselineRecord[]> {
    const rows = await this.contributors.readRowsBefore(
      { year, visibility: ActivityVisibility.PUBLIC },
      before,
    );
    return rows.map(toBaselineRecord);
  }

  async listActivityByYear(
    year: number,
  ): Promise<readonly StaffInsightsBaselineRecord[]> {
    const rows = await this.contributors.readStandingRows({
      year,
      visibility: ActivityVisibility.PUBLIC,
    });
    return rows.map(toBaselineRecord);
  }

  async listActivityYears(): Promise<readonly number[]> {
    return this.contributors.readStandingYears({
      year: null,
      visibility: ActivityVisibility.PUBLIC,
    });
  }

  async findActivityDataAsOf(): Promise<Date | null> {
    return this.contributors.readStandingObservedAt({
      year: null,
      visibility: ActivityVisibility.PUBLIC,
    });
  }
}
