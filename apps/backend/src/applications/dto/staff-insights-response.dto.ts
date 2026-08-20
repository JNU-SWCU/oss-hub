import type { DepartmentCohort } from '../department-cohort';
import type { InsightsYearScope } from '../staff-insights-year';
import type {
  StaffInsightsCohortRow,
  StaffInsightsDepartmentRow,
  StaffInsightsMetrics,
  StaffInsightsProgramRow,
  StaffInsightsSummary,
} from '../staff-insights.service';

export class StaffInsightsScopeResponseDto {
  readonly kind: InsightsYearScope['kind'];
  readonly year?: number;

  private constructor(scope: InsightsYearScope) {
    this.kind = scope.kind;
    if (scope.kind === 'calendar') {
      this.year = scope.year;
    }
  }

  static from(scope: InsightsYearScope): StaffInsightsScopeResponseDto {
    return new StaffInsightsScopeResponseDto(scope);
  }
}

export class StaffInsightsMetricsResponseDto {
  readonly studentCount: number;
  readonly activeStudentCount: number;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly total: number;
  readonly participantCount: number;

  protected constructor(metrics: StaffInsightsMetrics) {
    this.studentCount = metrics.studentCount;
    this.activeStudentCount = metrics.activeStudentCount;
    this.commitCount = metrics.commitCount;
    this.pullRequestCount = metrics.pullRequestCount;
    this.issueCount = metrics.issueCount;
    this.repositoryCount = metrics.repositoryCount;
    this.starCount = metrics.starCount;
    this.total = metrics.total;
    this.participantCount = metrics.participantCount;
  }
}

export class StaffInsightsCohortResponseDto extends StaffInsightsMetricsResponseDto {
  readonly cohort: DepartmentCohort;

  private constructor(row: StaffInsightsCohortRow) {
    super(row);
    this.cohort = row.cohort;
  }

  static from(row: StaffInsightsCohortRow): StaffInsightsCohortResponseDto {
    return new StaffInsightsCohortResponseDto(row);
  }
}

export class StaffInsightsDepartmentResponseDto extends StaffInsightsMetricsResponseDto {
  readonly department: string;
  readonly cohort: DepartmentCohort;

  private constructor(row: StaffInsightsDepartmentRow) {
    super(row);
    this.department = row.department;
    this.cohort = row.cohort;
  }

  static from(
    row: StaffInsightsDepartmentRow,
  ): StaffInsightsDepartmentResponseDto {
    return new StaffInsightsDepartmentResponseDto(row);
  }
}

export class StaffInsightsProgramResponseDto {
  readonly programId: string;
  readonly name: string;
  readonly swMajorCount: number;
  readonly nonSwCount: number;
  readonly unregisteredCount: number;
  readonly participantCount: number;

  private constructor(row: StaffInsightsProgramRow) {
    this.programId = row.programId;
    this.name = row.name;
    this.swMajorCount = row.swMajorCount;
    this.nonSwCount = row.nonSwCount;
    this.unregisteredCount = row.unregisteredCount;
    this.participantCount = row.participantCount;
  }

  static from(row: StaffInsightsProgramRow): StaffInsightsProgramResponseDto {
    return new StaffInsightsProgramResponseDto(row);
  }
}

export class StaffInsightsResponseDto {
  readonly scope: StaffInsightsScopeResponseDto;
  readonly dataAsOf: string | null;
  readonly years: readonly number[];
  readonly cohorts: readonly StaffInsightsCohortResponseDto[];
  readonly departments: readonly StaffInsightsDepartmentResponseDto[];
  readonly programs: readonly StaffInsightsProgramResponseDto[];

  private constructor(summary: StaffInsightsSummary) {
    this.scope = StaffInsightsScopeResponseDto.from(summary.scope);
    this.dataAsOf =
      summary.dataAsOf === null ? null : summary.dataAsOf.toISOString();
    this.years = summary.years;
    this.cohorts = summary.cohorts.map((row) =>
      StaffInsightsCohortResponseDto.from(row),
    );
    this.departments = summary.departments.map((row) =>
      StaffInsightsDepartmentResponseDto.from(row),
    );
    this.programs = summary.programs.map((row) =>
      StaffInsightsProgramResponseDto.from(row),
    );
  }

  static from(summary: StaffInsightsSummary): StaffInsightsResponseDto {
    return new StaffInsightsResponseDto(summary);
  }
}
