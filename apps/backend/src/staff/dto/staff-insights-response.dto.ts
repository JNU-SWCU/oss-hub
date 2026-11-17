import type { ProgramCategory } from '@prisma/client';
import type {
  StaffInsightsCohortRow,
  StaffInsightsCohortLeaders,
  StaffInsightsDepartmentRow,
  StaffInsightsLeaderRow,
  StaffInsightsLeaders,
  StaffInsightsMetrics,
  StaffInsightsProgramRow,
  StaffInsightsProgramSummary,
  StaffInsightsRecentLeaderRow,
  StaffInsightsSummary,
} from '../staff-insights.service';
import type {
  DepartmentCohort,
  InsightsYearScope,
} from '../staff-insights-query.service';

export class StaffInsightsScopeResponseDto {
  declare readonly kind: InsightsYearScope['kind'];
  declare readonly year?: number;

  static from(scope: InsightsYearScope): StaffInsightsScopeResponseDto {
    if (scope.kind === 'calendar') {
      return { kind: scope.kind, year: scope.year };
    }
    return { kind: scope.kind };
  }
}

class StaffInsightsMetricsResponseDto {
  declare readonly studentCount: number;
  declare readonly activeStudentCount: number;
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly issueCount: number;
  declare readonly repositoryCount: number;
  declare readonly starCount: number;
  declare readonly total: number;
  declare readonly participantCount: number;

  static from(metrics: StaffInsightsMetrics): StaffInsightsMetricsResponseDto {
    return {
      studentCount: metrics.studentCount,
      activeStudentCount: metrics.activeStudentCount,
      commitCount: metrics.commitCount,
      pullRequestCount: metrics.pullRequestCount,
      issueCount: metrics.issueCount,
      repositoryCount: metrics.repositoryCount,
      starCount: metrics.starCount,
      total: metrics.total,
      participantCount: metrics.participantCount,
    };
  }
}

export class StaffInsightsCohortResponseDto extends StaffInsightsMetricsResponseDto {
  declare readonly cohort: DepartmentCohort;

  static override from(
    row: StaffInsightsCohortRow,
  ): StaffInsightsCohortResponseDto {
    const metrics = StaffInsightsMetricsResponseDto.from(row);
    return {
      studentCount: metrics.studentCount,
      activeStudentCount: metrics.activeStudentCount,
      commitCount: metrics.commitCount,
      pullRequestCount: metrics.pullRequestCount,
      issueCount: metrics.issueCount,
      repositoryCount: metrics.repositoryCount,
      starCount: metrics.starCount,
      total: metrics.total,
      participantCount: metrics.participantCount,
      cohort: row.cohort,
    };
  }
}

export class StaffInsightsDepartmentResponseDto extends StaffInsightsMetricsResponseDto {
  declare readonly department: string;
  declare readonly cohort: DepartmentCohort;
  declare readonly activityPerStudent: number;
  declare readonly sampleTooSmall: boolean;

  static override from(
    row: StaffInsightsDepartmentRow,
  ): StaffInsightsDepartmentResponseDto {
    const metrics = StaffInsightsMetricsResponseDto.from(row);
    return {
      studentCount: metrics.studentCount,
      activeStudentCount: metrics.activeStudentCount,
      commitCount: metrics.commitCount,
      pullRequestCount: metrics.pullRequestCount,
      issueCount: metrics.issueCount,
      repositoryCount: metrics.repositoryCount,
      starCount: metrics.starCount,
      total: metrics.total,
      participantCount: metrics.participantCount,
      department: row.department,
      cohort: row.cohort,
      activityPerStudent: row.activityPerStudent,
      sampleTooSmall: row.sampleTooSmall,
    };
  }
}

export class StaffInsightsRecentLeaderResponseDto {
  declare readonly rank: number;
  declare readonly name: string | null;
  declare readonly githubLogin: string;
  declare readonly department: string | null;
  declare readonly cohort: DepartmentCohort;
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly issueCount: number;
  declare readonly repositoryCount: number;
  declare readonly total: number;

  static from(
    row: StaffInsightsRecentLeaderRow,
  ): StaffInsightsRecentLeaderResponseDto {
    return {
      rank: row.rank,
      name: row.name,
      githubLogin: row.githubLogin,
      department: row.department,
      cohort: row.cohort,
      commitCount: row.commitCount,
      pullRequestCount: row.pullRequestCount,
      issueCount: row.issueCount,
      repositoryCount: row.repositoryCount,
      total: row.total,
    };
  }
}

export class StaffInsightsLeaderResponseDto extends StaffInsightsRecentLeaderResponseDto {
  declare readonly starCount: number;

  static override from(
    row: StaffInsightsLeaderRow,
  ): StaffInsightsLeaderResponseDto {
    return {
      rank: row.rank,
      name: row.name,
      githubLogin: row.githubLogin,
      department: row.department,
      cohort: row.cohort,
      commitCount: row.commitCount,
      pullRequestCount: row.pullRequestCount,
      issueCount: row.issueCount,
      repositoryCount: row.repositoryCount,
      starCount: row.starCount,
      total: row.total,
    };
  }
}

export class StaffInsightsCohortLeadersResponseDto {
  declare readonly all: StaffInsightsLeaderResponseDto[];
  declare readonly swMajor: StaffInsightsLeaderResponseDto[];
  declare readonly nonSw: StaffInsightsLeaderResponseDto[];

  static from(
    leaders: StaffInsightsCohortLeaders<StaffInsightsLeaderRow>,
  ): StaffInsightsCohortLeadersResponseDto {
    return {
      all: leaders.all.map((row) => StaffInsightsLeaderResponseDto.from(row)),
      swMajor: leaders.swMajor.map((row) =>
        StaffInsightsLeaderResponseDto.from(row),
      ),
      nonSw: leaders.nonSw.map((row) =>
        StaffInsightsLeaderResponseDto.from(row),
      ),
    };
  }
}

export class StaffInsightsRecentCohortLeadersResponseDto {
  declare readonly all: StaffInsightsRecentLeaderResponseDto[];
  declare readonly swMajor: StaffInsightsRecentLeaderResponseDto[];
  declare readonly nonSw: StaffInsightsRecentLeaderResponseDto[];

  static from(
    leaders: StaffInsightsCohortLeaders<StaffInsightsRecentLeaderRow>,
  ): StaffInsightsRecentCohortLeadersResponseDto {
    return {
      all: leaders.all.map((row) =>
        StaffInsightsRecentLeaderResponseDto.from(row),
      ),
      swMajor: leaders.swMajor.map((row) =>
        StaffInsightsRecentLeaderResponseDto.from(row),
      ),
      nonSw: leaders.nonSw.map((row) =>
        StaffInsightsRecentLeaderResponseDto.from(row),
      ),
    };
  }
}

export class StaffInsightsLeadersResponseDto {
  declare readonly period: StaffInsightsCohortLeadersResponseDto;
  declare readonly recent: StaffInsightsRecentCohortLeadersResponseDto;

  static from(leaders: StaffInsightsLeaders): StaffInsightsLeadersResponseDto {
    return {
      period: StaffInsightsCohortLeadersResponseDto.from(leaders.period),
      recent: StaffInsightsRecentCohortLeadersResponseDto.from(leaders.recent),
    };
  }
}

export class StaffInsightsProgramResponseDto {
  declare readonly programId: string;
  declare readonly name: string;
  declare readonly category: ProgramCategory;
  declare readonly startAt: string;
  declare readonly endAt: string;
  declare readonly recruiting: boolean;
  declare readonly swMajorCount: number;
  declare readonly nonSwCount: number;
  declare readonly unregisteredCount: number;
  declare readonly participantCount: number;
  declare readonly appliedCount: number;
  declare readonly approvedCount: number;
  declare readonly competitionRatio: number | null;
  declare readonly dueRequirementCount: number;
  declare readonly submittedRequirementCount: number;
  declare readonly completionRate: number | null;
  declare readonly contributionCount: number;
  declare readonly activeTeamCount: number;
  declare readonly repoTeamCount: number;
  declare readonly contributionsPerParticipant: number | null;

  static from(row: StaffInsightsProgramRow): StaffInsightsProgramResponseDto {
    return {
      programId: row.programId,
      name: row.name,
      category: row.category,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      recruiting: row.recruiting,
      swMajorCount: row.swMajorCount,
      nonSwCount: row.nonSwCount,
      unregisteredCount: row.unregisteredCount,
      participantCount: row.participantCount,
      appliedCount: row.appliedCount,
      approvedCount: row.approvedCount,
      competitionRatio: row.competitionRatio,
      dueRequirementCount: row.dueRequirementCount,
      submittedRequirementCount: row.submittedRequirementCount,
      completionRate: row.completionRate,
      contributionCount: row.contributionCount,
      activeTeamCount: row.activeTeamCount,
      repoTeamCount: row.repoTeamCount,
      contributionsPerParticipant: row.contributionsPerParticipant,
    };
  }
}

export class StaffInsightsProgramSummaryResponseDto {
  declare readonly programCount: number;
  declare readonly recruitingCount: number;
  declare readonly approvedParticipantCount: number;
  declare readonly uniqueParticipantCount: number;
  declare readonly competitionRatio: number | null;
  declare readonly repeatParticipantCount: number;
  declare readonly repeatParticipantRate: number | null;

  static from(
    summary: StaffInsightsProgramSummary,
  ): StaffInsightsProgramSummaryResponseDto {
    return {
      programCount: summary.programCount,
      recruitingCount: summary.recruitingCount,
      approvedParticipantCount: summary.approvedParticipantCount,
      uniqueParticipantCount: summary.uniqueParticipantCount,
      competitionRatio: summary.competitionRatio,
      repeatParticipantCount: summary.repeatParticipantCount,
      repeatParticipantRate: summary.repeatParticipantRate,
    };
  }
}

export class StaffInsightsResponseDto {
  declare readonly scope: StaffInsightsScopeResponseDto;
  declare readonly dataAsOf: string | null;
  declare readonly years: number[];
  declare readonly cohorts: StaffInsightsCohortResponseDto[];
  declare readonly departments: StaffInsightsDepartmentResponseDto[];
  declare readonly programs: StaffInsightsProgramResponseDto[];
  declare readonly programSummary: StaffInsightsProgramSummaryResponseDto;
  declare readonly leaders: StaffInsightsLeadersResponseDto;
  declare readonly recentWindow: {
    readonly from: string;
    readonly to: string;
  };

  static from(summary: StaffInsightsSummary): StaffInsightsResponseDto {
    return {
      scope: StaffInsightsScopeResponseDto.from(summary.scope),
      dataAsOf:
        summary.dataAsOf === null ? null : summary.dataAsOf.toISOString(),
      years: [...summary.years],
      cohorts: summary.cohorts.map((row) =>
        StaffInsightsCohortResponseDto.from(row),
      ),
      departments: summary.departments.map((row) =>
        StaffInsightsDepartmentResponseDto.from(row),
      ),
      programs: summary.programs.map((row) =>
        StaffInsightsProgramResponseDto.from(row),
      ),
      programSummary: StaffInsightsProgramSummaryResponseDto.from(
        summary.programSummary,
      ),
      leaders: StaffInsightsLeadersResponseDto.from(summary.leaders),
      recentWindow: {
        from: summary.recentWindow.from.toISOString(),
        to: summary.recentWindow.to.toISOString(),
      },
    };
  }
}
