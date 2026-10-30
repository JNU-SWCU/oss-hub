import type { DepartmentCohort, InsightsYearScope } from '../staff.policy';
import type {
  StaffInsightsCohortRow,
  StaffInsightsDepartmentRow,
  StaffInsightsMetrics,
  StaffInsightsProgramRow,
  StaffInsightsSummary,
} from '../staff.types';

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
    return {
      ...StaffInsightsMetricsResponseDto.from(row),
      cohort: row.cohort,
    };
  }
}

export class StaffInsightsDepartmentResponseDto extends StaffInsightsMetricsResponseDto {
  declare readonly department: string;
  declare readonly cohort: DepartmentCohort;

  static override from(
    row: StaffInsightsDepartmentRow,
  ): StaffInsightsDepartmentResponseDto {
    return {
      ...StaffInsightsMetricsResponseDto.from(row),
      department: row.department,
      cohort: row.cohort,
    };
  }
}

export class StaffInsightsProgramResponseDto {
  declare readonly programId: string;
  declare readonly name: string;
  declare readonly swMajorCount: number;
  declare readonly nonSwCount: number;
  declare readonly unregisteredCount: number;
  declare readonly participantCount: number;

  static from(row: StaffInsightsProgramRow): StaffInsightsProgramResponseDto {
    return {
      programId: row.programId,
      name: row.name,
      swMajorCount: row.swMajorCount,
      nonSwCount: row.nonSwCount,
      unregisteredCount: row.unregisteredCount,
      participantCount: row.participantCount,
    };
  }
}

export class StaffInsightsResponseDto {
  declare readonly scope: StaffInsightsScopeResponseDto;
  declare readonly dataAsOf: string | null;
  declare readonly years: readonly number[];
  declare readonly cohorts: readonly StaffInsightsCohortResponseDto[];
  declare readonly departments: readonly StaffInsightsDepartmentResponseDto[];
  declare readonly programs: readonly StaffInsightsProgramResponseDto[];

  static from(summary: StaffInsightsSummary): StaffInsightsResponseDto {
    return {
      scope: StaffInsightsScopeResponseDto.from(summary.scope),
      dataAsOf:
        summary.dataAsOf === null ? null : summary.dataAsOf.toISOString(),
      years: summary.years,
      cohorts: summary.cohorts.map((row) =>
        StaffInsightsCohortResponseDto.from(row),
      ),
      departments: summary.departments.map((row) =>
        StaffInsightsDepartmentResponseDto.from(row),
      ),
      programs: summary.programs.map((row) =>
        StaffInsightsProgramResponseDto.from(row),
      ),
    };
  }
}
