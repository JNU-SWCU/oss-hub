import type {
  MilestoneSubmissionType,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import type {
  CreatedSubmissionResult,
  ResubmittedSubmissionResult,
  SubmissionBlockedReason,
  SubmissionChecklistResult,
  SubmissionFormResult,
} from '../submissions.service';
import {
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
} from '../submission-upload.config';

function fileUploadLimits() {
  return {
    maxBytes: SUBMISSION_UPLOAD_MAX_BYTES,
    maxLabel: SUBMISSION_UPLOAD_MAX_LABEL,
  };
}

export class SubmissionFormResponseDto {
  declare readonly applicationId: string;
  declare readonly fileUpload: {
    readonly maxBytes: number;
    readonly maxLabel: string;
  };
  declare readonly applicationMode: 'PERSONAL' | 'TEAM';
  declare readonly milestone: {
    readonly id: string;
    readonly name: string;
    readonly dueAt: string;
    readonly dDay: number;
    readonly deadlineLabel: string;
    readonly submissionType: MilestoneSubmissionType;
    readonly instructions: string | null;
  };
  declare readonly existingSubmission: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly checklistUrl: string;
  } | null;
  declare readonly canSubmit: boolean;
  declare readonly blockedReason: SubmissionBlockedReason | null;

  static from(
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
}

export class CreatedSubmissionResponseDto {
  declare readonly submissionId: string;
  declare readonly status: SubmissionStatus;
  declare readonly submittedAt: string;

  static from(result: CreatedSubmissionResult): CreatedSubmissionResponseDto {
    return {
      submissionId: result.submissionId,
      status: result.status,
      submittedAt: result.submittedAt.toISOString(),
    };
  }
}

export class SubmissionFileMetadataResponseDto {
  declare readonly fileId: string;
  declare readonly fileName: string;
  declare readonly contentType: string;
  declare readonly size: number;
  declare readonly expiresAt: string;
  declare readonly downloadUrl: string;

  static from(
    file: NonNullable<
      NonNullable<
        SubmissionChecklistResult['items'][number]['submission']
      >['file']
    >,
  ): SubmissionFileMetadataResponseDto {
    return {
      fileId: file.fileId,
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.size,
      expiresAt: file.expiresAt.toISOString(),
      downloadUrl: `/api/v1/submission-files/${file.fileId}`,
    };
  }
}

export class SubmissionChecklistItemResponseDto {
  declare readonly milestoneId: string;
  declare readonly name: string;
  declare readonly dueAt: string;
  declare readonly submissionType: MilestoneSubmissionType;
  declare readonly submission: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly currentRevision: number;
    readonly decision: ReviewDecision | null;
    readonly lastReviewedAt: string | null;
    readonly reviewComment: string | null;
    readonly canResubmit: boolean;
    readonly file: SubmissionFileMetadataResponseDto | null;
  } | null;

  static from(
    item: SubmissionChecklistResult['items'][number],
  ): SubmissionChecklistItemResponseDto {
    return {
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
              ? SubmissionFileMetadataResponseDto.from(item.submission.file)
              : null,
          }
        : null,
    };
  }
}

export class SubmissionChecklistResponseDto {
  declare readonly applicationId: string;
  declare readonly fileUpload: {
    readonly maxBytes: number;
    readonly maxLabel: string;
  };
  declare readonly applicationMode: 'PERSONAL' | 'TEAM';
  declare readonly items: readonly SubmissionChecklistItemResponseDto[];

  static from(
    result: SubmissionChecklistResult,
  ): SubmissionChecklistResponseDto {
    return {
      applicationId: result.applicationId,
      fileUpload: fileUploadLimits(),
      applicationMode: result.applicationMode,
      items: result.items.map((item) =>
        SubmissionChecklistItemResponseDto.from(item),
      ),
    };
  }
}

export class ResubmittedSubmissionResponseDto {
  declare readonly submissionId: string;
  declare readonly revision: number;
  declare readonly status: SubmissionStatus;

  static from(
    result: ResubmittedSubmissionResult,
  ): ResubmittedSubmissionResponseDto {
    return {
      submissionId: result.submissionId,
      revision: result.revision,
      status: result.status,
    };
  }
}
