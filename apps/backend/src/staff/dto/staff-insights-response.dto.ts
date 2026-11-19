import { ApiProperty } from '@nestjs/swagger';
import type { ProgramCategory } from '@prisma/client';
import type {
  StaffInsightsFinderPage,
  StaffInsightsFinderRow,
} from '../staff-insights.repository';
import type {
  StaffInsightsAttentionStudentRow,
  StaffInsightsCohortRow,
  StaffInsightsCohortLeaders,
  StaffInsightsDepartmentRow,
  StaffInsightsLeaders,
  StaffInsightsPeriodLeaderRow,
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

export class StaffInsightsCohortResponseDto {
  declare readonly cohort: DepartmentCohort;
  declare readonly studentCount: number;
  declare readonly activeStudentCount: number;
  declare readonly participantCount: number;

  static from(row: StaffInsightsCohortRow): StaffInsightsCohortResponseDto {
    return {
      cohort: row.cohort,
      studentCount: row.studentCount,
      activeStudentCount: row.activeStudentCount,
      participantCount: row.participantCount,
    };
  }
}

export class StaffInsightsDepartmentResponseDto {
  declare readonly department: string;
  declare readonly major: string | null;
  declare readonly cohort: DepartmentCohort;
  declare readonly studentCount: number;
  declare readonly activeStudentCount: number;
  declare readonly participantCount: number;
  declare readonly activityPerStudent: number;
  declare readonly recentPerStudent: number | null;
  declare readonly sampleTooSmall: boolean;

  static from(
    row: StaffInsightsDepartmentRow,
  ): StaffInsightsDepartmentResponseDto {
    return {
      department: row.department,
      major: row.major,
      cohort: row.cohort,
      studentCount: row.studentCount,
      activeStudentCount: row.activeStudentCount,
      participantCount: row.participantCount,
      activityPerStudent: row.activityPerStudent,
      recentPerStudent: row.recentPerStudent,
      sampleTooSmall: row.sampleTooSmall,
    };
  }
}

export class StaffInsightsLeaderResponseDto {
  declare readonly rank: number;
  declare readonly name: string | null;
  declare readonly githubLogin: string;
  declare readonly department: string | null;
  declare readonly total: number;

  static from(
    row: StaffInsightsRecentLeaderRow,
  ): StaffInsightsLeaderResponseDto {
    return {
      rank: row.rank,
      name: row.name,
      githubLogin: row.githubLogin,
      department: row.department,
      total: row.total,
    };
  }
}

export class StaffInsightsCohortLeadersResponseDto {
  declare readonly all: StaffInsightsLeaderResponseDto[];
  declare readonly swMajor: StaffInsightsLeaderResponseDto[];
  declare readonly nonSw: StaffInsightsLeaderResponseDto[];

  static from(
    leaders: StaffInsightsCohortLeaders<StaffInsightsRecentLeaderRow>,
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

class StaffInsightsPeriodLeaderResponseDto extends StaffInsightsLeaderResponseDto {
  declare readonly studentId: string | null;
  declare readonly major: string | null;

  @ApiProperty({ type: 'integer', minimum: 0, nullable: true })
  declare readonly recentTotal: number | null;

  @ApiProperty({ type: 'integer', minimum: 1, nullable: true })
  declare readonly previousRank: number | null;

  @ApiProperty({ type: 'number', minimum: 0, maximum: 1, nullable: true })
  declare readonly collaborationRatio: number | null;

  static override from(
    row: StaffInsightsPeriodLeaderRow,
  ): StaffInsightsPeriodLeaderResponseDto {
    return {
      rank: row.rank,
      name: row.name,
      githubLogin: row.githubLogin,
      department: row.department,
      total: row.total,
      studentId: row.studentId,
      major: row.major,
      recentTotal: row.recentTotal,
      previousRank: row.previousRank,
      collaborationRatio: row.collaborationRatio,
    };
  }
}

class StaffInsightsPeriodCohortLeadersResponseDto {
  declare readonly all: StaffInsightsPeriodLeaderResponseDto[];
  declare readonly swMajor: StaffInsightsPeriodLeaderResponseDto[];
  declare readonly nonSw: StaffInsightsPeriodLeaderResponseDto[];

  static from(
    leaders: StaffInsightsCohortLeaders<StaffInsightsPeriodLeaderRow>,
  ): StaffInsightsPeriodCohortLeadersResponseDto {
    return {
      all: leaders.all.map((row) =>
        StaffInsightsPeriodLeaderResponseDto.from(row),
      ),
      swMajor: leaders.swMajor.map((row) =>
        StaffInsightsPeriodLeaderResponseDto.from(row),
      ),
      nonSw: leaders.nonSw.map((row) =>
        StaffInsightsPeriodLeaderResponseDto.from(row),
      ),
    };
  }
}

export class StaffInsightsLeadersResponseDto {
  declare readonly period: StaffInsightsPeriodCohortLeadersResponseDto;
  declare readonly recent: StaffInsightsCohortLeadersResponseDto;

  static from(leaders: StaffInsightsLeaders): StaffInsightsLeadersResponseDto {
    return {
      period: StaffInsightsPeriodCohortLeadersResponseDto.from(leaders.period),
      recent: StaffInsightsCohortLeadersResponseDto.from(leaders.recent),
    };
  }
}

class StaffInsightsAttentionStudentResponseDto {
  declare readonly name: string | null;
  declare readonly githubLogin: string;
  declare readonly studentId: string | null;
  declare readonly department: string | null;
  declare readonly total: number;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  declare readonly lastActiveAt: string | null;

  static from(
    row: StaffInsightsAttentionStudentRow,
  ): StaffInsightsAttentionStudentResponseDto {
    return {
      name: row.name,
      githubLogin: row.githubLogin,
      studentId: row.studentId,
      department: row.department,
      total: row.total,
      lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
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
  declare readonly attentionStudents: StaffInsightsAttentionStudentResponseDto[];

  @ApiProperty({ type: 'integer', minimum: 0, nullable: true })
  declare readonly firstContributionCount: number | null;

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
      attentionStudents: summary.attentionStudents.map((row) =>
        StaffInsightsAttentionStudentResponseDto.from(row),
      ),
      firstContributionCount: summary.firstContributionCount,
      recentWindow: {
        from: summary.recentWindow.from.toISOString(),
        to: summary.recentWindow.to.toISOString(),
      },
    };
  }
}

class StaffInsightsFinderRowResponseDto {
  declare readonly name: string | null;
  declare readonly githubLogin: string;
  declare readonly studentId: string | null;
  declare readonly major: string | null;

  @ApiProperty({ type: 'integer', minimum: 0 })
  declare readonly total: number;

  @ApiProperty({ type: 'integer', minimum: 0, nullable: true })
  declare readonly recentTotal: number | null;

  @ApiProperty({ type: 'number', minimum: 0, maximum: 1, nullable: true })
  declare readonly collaborationRatio: number | null;

  declare readonly programIds: string[];

  static from(row: StaffInsightsFinderRow): StaffInsightsFinderRowResponseDto {
    return {
      name: row.name,
      githubLogin: row.githubLogin,
      studentId: row.studentId,
      major: row.major,
      total: row.total,
      recentTotal: row.recentTotal,
      collaborationRatio: row.collaborationRatio,
      programIds: [...row.programIds],
    };
  }
}

export class StaffInsightsFinderResponseDto {
  declare readonly rows: StaffInsightsFinderRowResponseDto[];

  @ApiProperty({ type: 'integer', minimum: 1 })
  declare readonly page: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  declare readonly pageSize: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  declare readonly total: number;

  static from(page: StaffInsightsFinderPage): StaffInsightsFinderResponseDto {
    return {
      rows: page.rows.map((row) => StaffInsightsFinderRowResponseDto.from(row)),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
    };
  }
}
