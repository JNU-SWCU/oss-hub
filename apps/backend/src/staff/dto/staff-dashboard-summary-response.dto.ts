import type { ProgramTrackType } from '@prisma/client';
import type { StaffDashboardApplicationCounts } from '../../programs/team.repository';
import type {
  StaffDashboardActivitySummary,
  StaffDashboardComposedProgramSummary,
  StaffDashboardComposedSummary,
  StaffDashboardSubmissionSummary,
} from '../staff-dashboard.service';

export class StaffDashboardApplicationCountsResponseDto {
  declare readonly total: number;
  declare readonly pendingApproval: number;
  declare readonly approved: number;
  declare readonly rejected: number;

  static from(
    counts: StaffDashboardApplicationCounts,
  ): StaffDashboardApplicationCountsResponseDto {
    return {
      total: counts.total,
      pendingApproval: counts.pendingApproval,
      approved: counts.approved,
      rejected: counts.rejected,
    };
  }
}

export class StaffDashboardActivitySummaryResponseDto {
  declare readonly repositories: number;
  declare readonly commits: number;
  declare readonly pullRequests: number;
  declare readonly releases: number;
  declare readonly lastActivityAt: string | null;
  declare readonly dataAsOf: string | null;

  static from(
    activity: StaffDashboardActivitySummary,
  ): StaffDashboardActivitySummaryResponseDto {
    return {
      repositories: activity.repositories,
      commits: activity.commits,
      pullRequests: activity.pullRequests,
      releases: activity.releases,
      lastActivityAt: activity.lastActivityAt,
      dataAsOf: activity.dataAsOf,
    };
  }
}

export class StaffDashboardSubmissionSummaryResponseDto {
  declare readonly milestones: number;
  declare readonly total: number;
  declare readonly notSubmitted: number;
  declare readonly submitted: number;
  declare readonly approved: number;
  declare readonly changesRequested: number;
  declare readonly rejected: number;

  static from(
    submissions: StaffDashboardSubmissionSummary,
  ): StaffDashboardSubmissionSummaryResponseDto {
    return {
      milestones: submissions.milestones,
      total: submissions.total,
      notSubmitted: submissions.notSubmitted,
      submitted: submissions.submitted,
      approved: submissions.approved,
      changesRequested: submissions.changesRequested,
      rejected: submissions.rejected,
    };
  }
}

export class StaffDashboardProgramSummaryResponseDto {
  declare readonly coverImageUrl: string | null;
  declare readonly id: string;
  declare readonly name: string;
  declare readonly trackType: ProgramTrackType | null;
  declare readonly applicationPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };

  declare readonly endAt: string;
  declare readonly applications: StaffDashboardApplicationCountsResponseDto;
  declare readonly activity: StaffDashboardActivitySummaryResponseDto;
  declare readonly submissions: StaffDashboardSubmissionSummaryResponseDto;

  static from(
    program: StaffDashboardComposedProgramSummary,
  ): StaffDashboardProgramSummaryResponseDto {
    return {
      coverImageUrl: program.coverImageUrl,
      id: program.id,
      name: program.name,
      trackType: program.trackType,
      applicationPeriod: {
        startsAt: program.applicationPeriod.startsAt.toISOString(),
        endsAt: program.applicationPeriod.endsAt.toISOString(),
      },
      endAt: program.endAt.toISOString(),
      applications: StaffDashboardApplicationCountsResponseDto.from(
        program.applications,
      ),
      activity: StaffDashboardActivitySummaryResponseDto.from(program.activity),
      submissions: StaffDashboardSubmissionSummaryResponseDto.from(
        program.submissions,
      ),
    };
  }
}

export class StaffDashboardStatusSummaryResponseDto {
  declare readonly recruiting: number;
  declare readonly inProgress: number;
  declare readonly ended: number;

  static from(
    summary: StaffDashboardComposedSummary['statusSummary'],
  ): StaffDashboardStatusSummaryResponseDto {
    return {
      recruiting: summary.recruiting,
      inProgress: summary.inProgress,
      ended: summary.ended,
    };
  }
}

export class StaffDashboardSummaryResponseDto {
  declare readonly programs: StaffDashboardProgramSummaryResponseDto[];
  declare readonly page: number;
  declare readonly pageSize: number;
  declare readonly total: number;
  declare readonly catalogTotal: number;
  declare readonly statusSummary: StaffDashboardStatusSummaryResponseDto;

  static from(
    summary: StaffDashboardComposedSummary,
  ): StaffDashboardSummaryResponseDto {
    return {
      page: summary.page,
      pageSize: summary.pageSize,
      total: summary.total,
      catalogTotal: summary.catalogTotal,
      statusSummary: StaffDashboardStatusSummaryResponseDto.from(
        summary.statusSummary,
      ),
      programs: summary.programs.map((program) =>
        StaffDashboardProgramSummaryResponseDto.from(program),
      ),
    };
  }
}
