import type {
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  Role,
  SubmissionStatus,
} from '@prisma/client';

export type ProgramViewerRoleResponseDto = Role | 'PENDING' | null;
export type ViewerSubmissionStatusResponseDto =
  SubmissionStatus | 'NOT_SUBMITTED' | null;

export interface ApplicationSubmissionSummaryResponseDto {
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
  readonly total: number;
}

export interface ProgramMilestoneResponseDto {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
  readonly dDay: number;
  readonly deadlineLabel: string;
  readonly description: string | null;
  readonly submissionType: MilestoneSubmissionType;
  readonly viewerSubmissionStatus: ViewerSubmissionStatusResponseDto;
  readonly applicationSubmissionSummary: ApplicationSubmissionSummaryResponseDto | null;
}

export interface ProgramDetailResponseDto {
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
    readonly role: ProgramViewerRoleResponseDto;
    readonly applicationStatus: ApplicationStatus | null;
  };
  readonly milestones: readonly ProgramMilestoneResponseDto[];
}

export interface ProgramActivityResponseDto {
  readonly applicationId: string;
  readonly label: string;
  readonly commitCount: number;
  readonly lastActivityAt: string | null;
}
