import type {
  CreatedSubmissionResult,
  ResubmittedSubmissionResult,
  SubmissionBlockedReason,
  SubmissionChecklistResult,
  SubmissionFormResult,
} from '../domain/submission-result';
import {
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
} from '../domain/submission-upload-policy';

import type {
  MilestoneSubmissionType,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';

export interface SubmissionFormResponseDto {
  readonly fileUpload: { readonly maxBytes: number; readonly maxLabel: string };
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
  readonly existingSubmission: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly checklistUrl: string;
  } | null;
  readonly canSubmit: boolean;
  readonly blockedReason: SubmissionBlockedReason | null;
}

export interface CreatedSubmissionResponseDto {
  readonly submissionId: string;
  readonly status: SubmissionStatus;
  readonly submittedAt: string;
}

interface SubmissionFileMetadataResponseDto {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
  readonly downloadUrl: string;
}

interface SubmissionChecklistItemResponseDto {
  readonly milestoneId: string;
  readonly name: string;
  readonly dueAt: string;
  readonly submissionType: MilestoneSubmissionType;
  readonly submission: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly currentRevision: number;
    readonly decision: ReviewDecision | null;
    readonly lastReviewedAt: string | null;
    readonly reviewComment: string | null;
    readonly canResubmit: boolean;
    readonly file: SubmissionFileMetadataResponseDto | null;
  } | null;
}

export interface SubmissionChecklistResponseDto {
  readonly fileUpload: { readonly maxBytes: number; readonly maxLabel: string };
  readonly applicationId: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly items: readonly SubmissionChecklistItemResponseDto[];
}

export interface ResubmittedSubmissionResponseDto {
  readonly submissionId: string;
  readonly revision: number;
  readonly status: SubmissionStatus;
}

function fileUploadLimits() {
  return {
    maxBytes: SUBMISSION_UPLOAD_MAX_BYTES,
    maxLabel: SUBMISSION_UPLOAD_MAX_LABEL,
  };
}

export function presentSubmissionForm(
  result: SubmissionFormResult,
  programId: string,
  milestoneId: string,
): SubmissionFormResponseDto {
  return {
    applicationId: result.applicationId,
    fileUpload: fileUploadLimits(),
    applicationMode: result.applicationMode,
    milestone: {
      id: result.milestone.id,
      name: result.milestone.name,
      dueAt: result.milestone.dueAt.toISOString(),
      dDay: result.milestone.dDay,
      deadlineLabel: result.milestone.deadlineLabel,
      submissionType: result.milestone.submissionType,
      instructions: result.milestone.instructions,
    },
    existingSubmission: result.existingSubmission
      ? {
          id: result.existingSubmission.id,
          status: result.existingSubmission.status,
          checklistUrl: `/programs/${programId}/submissions?milestoneId=${milestoneId}`,
        }
      : null,
    canSubmit: result.canSubmit,
    blockedReason: result.blockedReason,
  };
}

export function presentCreatedSubmission(
  result: CreatedSubmissionResult,
): CreatedSubmissionResponseDto {
  return {
    submissionId: result.submissionId,
    status: result.status,
    submittedAt: result.submittedAt.toISOString(),
  };
}

export function presentResubmittedSubmission(
  result: ResubmittedSubmissionResult,
): ResubmittedSubmissionResponseDto {
  return {
    submissionId: result.submissionId,
    revision: result.revision,
    status: result.status,
  };
}

export function presentSubmissionChecklist(
  result: SubmissionChecklistResult,
): SubmissionChecklistResponseDto {
  return {
    applicationId: result.applicationId,
    fileUpload: fileUploadLimits(),
    applicationMode: result.applicationMode,
    items: result.items.map((item) => ({
      milestoneId: item.milestoneId,
      name: item.name,
      dueAt: item.dueAt.toISOString(),
      submissionType: item.submissionType,
      submission: item.submission
        ? {
            id: item.submission.id,
            status: item.submission.status,
            currentRevision: item.submission.currentRevision,
            decision: item.submission.decision,
            lastReviewedAt:
              item.submission.lastReviewedAt?.toISOString() ?? null,
            reviewComment: item.submission.reviewComment,
            canResubmit: item.submission.canResubmit,
            file: item.submission.file
              ? {
                  fileId: item.submission.file.fileId,
                  fileName: item.submission.file.fileName,
                  contentType: item.submission.file.contentType,
                  size: item.submission.file.size,
                  expiresAt: item.submission.file.expiresAt.toISOString(),
                  downloadUrl: `/api/v1/submission-files/${item.submission.file.fileId}`,
                }
              : null,
          }
        : null,
    })),
  };
}
