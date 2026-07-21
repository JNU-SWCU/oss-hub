export type ViewerRole = 'STUDENT' | 'STAFF' | 'ADMIN' | 'PENDING' | null;
export type ApplicationStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type SubmissionStatus =
  'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
export type SubmissionType = 'FILE' | 'TEXT' | 'REPOSITORY_RELEASE';

export interface SubmissionSummary {
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
  readonly total: number;
}

export interface ProgramMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
  readonly dDay: number;
  readonly deadlineLabel: string;
  readonly description: string | null;
  readonly submissionType: SubmissionType;
  readonly viewerSubmissionStatus: SubmissionStatus | null;
  readonly applicationSubmissionSummary: SubmissionSummary | null;
}

export interface ProgramDetail {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category:
    | 'BASIC'
    | 'SW_VALUE_SPREAD'
    | 'OSS_CONTEST'
    | 'CAPSTONE'
    | 'SW_CONVERGENCE'
    | 'GLOBAL_MAKERTHON'
    | 'CORPORATE_INTERNSHIP';
  readonly description: string;
  readonly applicationPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  readonly viewer: {
    readonly role: ViewerRole;
    readonly applicationStatus: ApplicationStatus | null;
  };
  readonly milestones: readonly ProgramMilestone[];
}

export interface ProgramActivity {
  readonly applicationId: string;
  readonly label: string;
  readonly commitCount: number;
  readonly lastActivityAt: string | null;
}
