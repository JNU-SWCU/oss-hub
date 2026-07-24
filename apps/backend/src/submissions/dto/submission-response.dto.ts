import type { MilestoneSubmissionType, SubmissionStatus } from '@prisma/client';

export type SubmissionBlockedReasonResponseDto =
  | 'SUBMISSION_ALREADY_EXISTS'
  | 'MILESTONE_CLOSED'
  | 'REPOSITORY_NOT_READY'
  | 'FILE_UPLOAD_UNAVAILABLE';

export interface SubmissionFormResponseDto {
  readonly applicationId: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly milestone: {
    readonly id: string;
    readonly name: string;
    readonly dueAt: string;
    readonly dDay: number;
    readonly deadlineLabel: string;
    readonly submissionType: MilestoneSubmissionType;
    readonly instructions: string | null;
  };
  readonly repository: {
    readonly url: string;
    readonly status: 'READY';
  } | null;
  readonly existingSubmission: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly checklistUrl: string;
  } | null;
  readonly canSubmit: boolean;
  readonly blockedReason: SubmissionBlockedReasonResponseDto | null;
}

export interface CreatedSubmissionResponseDto {
  readonly submissionId: string;
  readonly status: SubmissionStatus;
  readonly submittedAt: string;
}

export interface SubmissionChecklistItemResponseDto {
  readonly milestoneId: string;
  readonly name: string;
  readonly dueAt: string;
  readonly submissionType: MilestoneSubmissionType;
  readonly submission: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly currentRevision: number;
    readonly lastReviewedAt: string | null;
    readonly reviewComment: string | null;
    readonly canResubmit: boolean;
  } | null;
}

export interface SubmissionChecklistResponseDto {
  readonly applicationId: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly items: readonly SubmissionChecklistItemResponseDto[];
}

export interface ResubmittedSubmissionResponseDto {
  readonly submissionId: string;
  readonly revision: number;
  readonly status: SubmissionStatus;
}
