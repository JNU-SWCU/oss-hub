import type { ProgramLifecycle, ProgramTrackType } from '@prisma/client';
import { programCoverImageUrl } from '../../programs/program-cover.policy';
import type {
  StaffDashboardActivitySummary,
  StaffDashboardComposedApplicationCounts,
  StaffDashboardComposedProgramSummary,
  StaffDashboardComposedSummary,
  StaffDashboardSubmissionSummary,
} from '../staff.types';

export class StaffDashboardApplicationCountsResponseDto {
  declare readonly total: number;
  declare readonly submitted: number;
  declare readonly pendingApproval: number;
  declare readonly approved: number;
  declare readonly rejected: number;

  static from(
    counts: StaffDashboardComposedApplicationCounts,
  ): StaffDashboardApplicationCountsResponseDto {
    return {
      total: counts.total,
      submitted: counts.submitted,
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
  declare readonly approvedApplications: number;
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
      approvedApplications: submissions.approvedApplications,
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

  declare readonly lifecycle: ProgramLifecycle;
  declare readonly applications: StaffDashboardApplicationCountsResponseDto;
  declare readonly teamManagementPath: string;
  declare readonly activity: StaffDashboardActivitySummaryResponseDto;
  declare readonly submissions: StaffDashboardSubmissionSummaryResponseDto;

  static from(
    program: StaffDashboardComposedProgramSummary,
  ): StaffDashboardProgramSummaryResponseDto {
    return {
      coverImageUrl: programCoverImageUrl(
        program.id,
        program.coverId,
        program.coverExternalImageUrl,
      ),
      id: program.id,
      name: program.name,
      trackType: program.trackType,
      applicationPeriod: {
        startsAt: program.applicationPeriod.startsAt.toISOString(),
        endsAt: program.applicationPeriod.endsAt.toISOString(),
      },
      endAt: program.endAt.toISOString(),
      lifecycle: program.lifecycle,
      applications: StaffDashboardApplicationCountsResponseDto.from(
        program.applications,
      ),
      teamManagementPath: program.teamManagementPath,
      activity: StaffDashboardActivitySummaryResponseDto.from(program.activity),
      submissions: StaffDashboardSubmissionSummaryResponseDto.from(
        program.submissions,
      ),
    };
  }
}

export class StaffDashboardSummaryResponseDto {
  declare readonly programs: readonly StaffDashboardProgramSummaryResponseDto[];

  static from(
    summary: StaffDashboardComposedSummary,
  ): StaffDashboardSummaryResponseDto {
    return {
      programs: summary.programs.map((program) =>
        StaffDashboardProgramSummaryResponseDto.from(program),
      ),
    };
  }
}
