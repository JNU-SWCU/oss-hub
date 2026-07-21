import type {
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  Role,
  SubmissionStatus,
} from '@prisma/client';

export type ProgramViewerRole = Role | 'PENDING' | null;
export type ViewerSubmissionStatus = SubmissionStatus | 'NOT_SUBMITTED' | null;

export interface ApplicationSubmissionSummaryDto {
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
  readonly total: number;
}

export interface ProgramMilestoneDto {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
  readonly dDay: number;
  readonly deadlineLabel: string;
  readonly description: string | null;
  readonly submissionType: MilestoneSubmissionType;
  readonly viewerSubmissionStatus: ViewerSubmissionStatus;
  readonly applicationSubmissionSummary: ApplicationSubmissionSummaryDto | null;
}

export interface ProgramDetailDto {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly description: string;
  readonly applicationPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  readonly viewer: {
    readonly role: ProgramViewerRole;
    readonly applicationStatus: ApplicationStatus | null;
  };
  readonly milestones: readonly ProgramMilestoneDto[];
}

export interface ProgramActivityDto {
  readonly applicationId: string;
  readonly label: string;
  readonly commitCount: number;
  readonly lastActivityAt: string | null;
}
