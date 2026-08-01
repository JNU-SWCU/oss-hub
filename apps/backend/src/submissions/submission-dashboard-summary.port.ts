export const SUBMISSION_DASHBOARD_SUMMARY_PORT = Symbol(
  'SUBMISSION_DASHBOARD_SUMMARY_PORT',
);

export interface SubmissionDashboardProgramSummary {
  readonly programId: string;
  readonly approvedApplications: number;
  readonly milestones: number;
  readonly total: number;
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
}

export interface SubmissionDashboardSummaryPort {
  listByProgram(
    programIds: readonly string[],
  ): Promise<readonly SubmissionDashboardProgramSummary[]>;
}
