import { Inject, Injectable } from '@nestjs/common';
import {
  ProgramActivitySummaryService,
  type ProgramActivitySummary,
} from '../programs/program-activity-summary.service';
import {
  SubmissionDashboardSummaryService,
  type SubmissionDashboardProgramSummary,
} from '../submissions/submission-dashboard-summary.service';
import type {
  StaffDashboardApplicationCounts,
  StaffDashboardProgramSummary,
} from './applications.repository';
import { ApplicationsService } from './applications.service';

export type StaffDashboardComposedApplicationCounts =
  StaffDashboardApplicationCounts & {
    readonly pendingApproval: number;
  };

export interface StaffDashboardActivitySummary {
  readonly repositories: number;
  readonly commits: number;
  readonly pullRequests: number;
  readonly releases: number;
  readonly lastActivityAt: string | null;
  readonly dataAsOf: string | null;
}

export interface StaffDashboardSubmissionSummary {
  readonly approvedApplications: number;
  readonly milestones: number;
  readonly total: number;
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
}

export type StaffDashboardComposedProgramSummary = Omit<
  StaffDashboardProgramSummary,
  'applications'
> & {
  readonly applications: StaffDashboardComposedApplicationCounts;
  readonly activity: StaffDashboardActivitySummary;
  readonly submissions: StaffDashboardSubmissionSummary;
};

export interface StaffDashboardComposedSummary {
  readonly programs: readonly StaffDashboardComposedProgramSummary[];
}

@Injectable()
export class StaffDashboardService {
  constructor(
    @Inject(ApplicationsService)
    private readonly applications: Pick<ApplicationsService, 'staffSummary'>,
    @Inject(ProgramActivitySummaryService)
    private readonly activities: Pick<
      ProgramActivitySummaryService,
      'summarize'
    >,
    @Inject(SubmissionDashboardSummaryService)
    private readonly submissions: Pick<
      SubmissionDashboardSummaryService,
      'listByProgram'
    >,
  ) {}

  async summary(): Promise<StaffDashboardComposedSummary> {
    const base = await this.applications.staffSummary();
    const programIds = base.programs.map((program) => program.id);
    const [activities, submissions] = await Promise.all([
      this.activities.summarize(programIds),
      this.submissions.listByProgram(programIds),
    ]);
    const activityByProgram = new Map(
      activities.map((activity) => [activity.programId, activity]),
    );
    const submissionsByProgram = new Map(
      submissions.map((submission) => [submission.programId, submission]),
    );

    return {
      programs: base.programs.map((program) => ({
        ...program,
        applications: {
          ...program.applications,
          pendingApproval: program.applications.submitted,
        },
        activity: activityFrom(activityByProgram.get(program.id)),
        submissions: submissionsFrom(submissionsByProgram.get(program.id)),
      })),
    };
  }
}

function activityFrom(
  activity: ProgramActivitySummary | undefined,
): StaffDashboardActivitySummary {
  if (!activity) {
    return {
      repositories: 0,
      commits: 0,
      pullRequests: 0,
      releases: 0,
      lastActivityAt: null,
      dataAsOf: null,
    };
  }
  return {
    repositories: activity.repositoryCount,
    commits: activity.commitCount,
    pullRequests: activity.pullRequestCount,
    releases: activity.releaseCount,
    lastActivityAt: activity.lastActivityAt,
    dataAsOf: activity.dataAsOf,
  };
}

function submissionsFrom(
  submissions: SubmissionDashboardProgramSummary | undefined,
): StaffDashboardSubmissionSummary {
  if (!submissions) {
    return {
      approvedApplications: 0,
      milestones: 0,
      total: 0,
      notSubmitted: 0,
      submitted: 0,
      approved: 0,
      changesRequested: 0,
      rejected: 0,
    };
  }
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
