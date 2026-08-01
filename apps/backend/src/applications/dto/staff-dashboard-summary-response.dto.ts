import type { ProgramCategory } from '@prisma/client';
import type {
  StaffDashboardActivitySummary,
  StaffDashboardComposedApplicationCounts,
  StaffDashboardComposedProgramSummary,
  StaffDashboardComposedSummary,
  StaffDashboardSubmissionSummary,
} from '../staff-dashboard.service';

export class StaffDashboardApplicationCountsResponseDto {
  readonly total: number;
  readonly submitted: number;
  readonly pendingApproval: number;
  readonly approved: number;
  readonly rejected: number;

  private constructor(counts: StaffDashboardComposedApplicationCounts) {
    this.total = counts.total;
    this.submitted = counts.submitted;
    this.pendingApproval = counts.pendingApproval;
    this.approved = counts.approved;
    this.rejected = counts.rejected;
  }

  static from(
    counts: StaffDashboardComposedApplicationCounts,
  ): StaffDashboardApplicationCountsResponseDto {
    return new StaffDashboardApplicationCountsResponseDto(counts);
  }
}

export class StaffDashboardActivitySummaryResponseDto {
  readonly repositories: number;
  readonly commits: number;
  readonly pullRequests: number;
  readonly releases: number;
  readonly lastActivityAt: string | null;
  readonly dataAsOf: string | null;

  private constructor(activity: StaffDashboardActivitySummary) {
    this.repositories = activity.repositories;
    this.commits = activity.commits;
    this.pullRequests = activity.pullRequests;
    this.releases = activity.releases;
    this.lastActivityAt = activity.lastActivityAt;
    this.dataAsOf = activity.dataAsOf;
  }

  static from(
    activity: StaffDashboardActivitySummary,
  ): StaffDashboardActivitySummaryResponseDto {
    return new StaffDashboardActivitySummaryResponseDto(activity);
  }
}

export class StaffDashboardSubmissionSummaryResponseDto {
  readonly approvedApplications: number;
  readonly milestones: number;
  readonly total: number;
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;

  private constructor(submissions: StaffDashboardSubmissionSummary) {
    this.approvedApplications = submissions.approvedApplications;
    this.milestones = submissions.milestones;
    this.total = submissions.total;
    this.notSubmitted = submissions.notSubmitted;
    this.submitted = submissions.submitted;
    this.approved = submissions.approved;
    this.changesRequested = submissions.changesRequested;
    this.rejected = submissions.rejected;
  }

  static from(
    submissions: StaffDashboardSubmissionSummary,
  ): StaffDashboardSubmissionSummaryResponseDto {
    return new StaffDashboardSubmissionSummaryResponseDto(submissions);
  }
}

export class StaffDashboardProgramSummaryResponseDto {
  readonly id: string;
  readonly name: string;
  readonly category: ProgramCategory;
  readonly applicationPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  readonly applications: StaffDashboardApplicationCountsResponseDto;
  readonly applicantsPath: string;
  readonly activity: StaffDashboardActivitySummaryResponseDto;
  readonly submissions: StaffDashboardSubmissionSummaryResponseDto;

  private constructor(program: StaffDashboardComposedProgramSummary) {
    this.id = program.id;
    this.name = program.name;
    this.category = program.category;
    this.applicationPeriod = {
      startsAt: program.applicationPeriod.startsAt.toISOString(),
      endsAt: program.applicationPeriod.endsAt.toISOString(),
    };
    this.applications = StaffDashboardApplicationCountsResponseDto.from(
      program.applications,
    );
    this.applicantsPath = program.applicantsPath;
    this.activity = StaffDashboardActivitySummaryResponseDto.from(
      program.activity,
    );
    this.submissions = StaffDashboardSubmissionSummaryResponseDto.from(
      program.submissions,
    );
  }

  static from(
    program: StaffDashboardComposedProgramSummary,
  ): StaffDashboardProgramSummaryResponseDto {
    return new StaffDashboardProgramSummaryResponseDto(program);
  }
}

export class StaffDashboardSummaryResponseDto {
  readonly programs: readonly StaffDashboardProgramSummaryResponseDto[];

  private constructor(summary: StaffDashboardComposedSummary) {
    this.programs = summary.programs.map((program) =>
      StaffDashboardProgramSummaryResponseDto.from(program),
    );
  }

  static from(
    summary: StaffDashboardComposedSummary,
  ): StaffDashboardSummaryResponseDto {
    return new StaffDashboardSummaryResponseDto(summary);
  }
}
