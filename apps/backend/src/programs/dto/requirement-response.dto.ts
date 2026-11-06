import { SubmissionStatus, RequirementSubmissionType } from '@prisma/client';
import type { RequirementViewerResult } from '../requirements.service';
import {
  SUBMISSION_UPLOAD_ACCEPT,
  SUBMISSION_UPLOAD_FORMAT_LABEL,
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
} from '../submission-upload.config';
export class RequirementViewerReviewResponseDto {
  declare readonly comment: string | null;
  declare readonly reviewedAt: string;
  static from(
    review: NonNullable<
      NonNullable<RequirementViewerResult['viewerSubmission']>['review']
    >,
  ): RequirementViewerReviewResponseDto {
    return {
      comment: review.comment,
      reviewedAt: review.reviewedAt.toISOString(),
    };
  }
}
export class RequirementViewerSubmissionResponseDto {
  declare readonly submitted: boolean;
  declare readonly submittedAt: string | null;
  declare readonly submittedLate: boolean;
  declare readonly revision: number | null;
  declare readonly status: SubmissionStatus | null;
  declare readonly hasCurrentFile: boolean;
  declare readonly currentFileName: string | null;
  declare readonly review: RequirementViewerReviewResponseDto | null;
  declare readonly history: {
    readonly hasHistory: boolean;
    readonly isComplete: boolean;
  };
  static from(
    submission: NonNullable<RequirementViewerResult['viewerSubmission']>,
  ): RequirementViewerSubmissionResponseDto {
    return {
      submitted: submission.submitted,
      submittedAt: submission.submittedAt?.toISOString() ?? null,
      submittedLate: submission.submittedLate,
      revision: submission.revision,
      status: submission.status,
      hasCurrentFile: submission.hasCurrentFile,
      currentFileName: submission.currentFileName,
      review:
        submission.review === null
          ? null
          : RequirementViewerReviewResponseDto.from(submission.review),
      history: submission.history,
    };
  }
}
export class RequirementTeamSubmissionCountResponseDto {
  declare readonly submitted: number;
  declare readonly total: number;
  static from(
    count: NonNullable<RequirementViewerResult['teamSubmissionCount']>,
  ): RequirementTeamSubmissionCountResponseDto {
    return { submitted: count.submitted, total: count.total };
  }
}
export class RequirementResponseDto {
  declare readonly id: string;
  declare readonly milestoneId: string;
  declare readonly name: string;
  declare readonly required: boolean;
  declare readonly submissionType: RequirementSubmissionType;
  declare readonly sortOrder: number;
  declare readonly graceDueAt: string | null;
  declare readonly hasTemplateFile: boolean;
  declare readonly templateFileName: string | null;
  declare readonly viewerSubmission?: RequirementViewerSubmissionResponseDto;
  declare readonly teamSubmissionCount?: RequirementTeamSubmissionCountResponseDto;
  static from(record: RequirementViewerResult): RequirementResponseDto {
    return {
      id: record.id,
      milestoneId: record.milestoneId,
      name: record.name,
      required: record.required,
      submissionType: record.submissionType,
      sortOrder: record.sortOrder,
      graceDueAt: record.graceDueAt?.toISOString() ?? null,
      hasTemplateFile: record.templateFileId !== null,
      templateFileName: record.templateFileName,
      viewerSubmission:
        record.viewerSubmission === undefined
          ? undefined
          : RequirementViewerSubmissionResponseDto.from(
              record.viewerSubmission,
            ),
      teamSubmissionCount:
        record.teamSubmissionCount === undefined
          ? undefined
          : RequirementTeamSubmissionCountResponseDto.from(
              record.teamSubmissionCount,
            ),
    };
  }
}
export class RequirementUploadPolicyResponseDto {
  declare readonly maxBytes: number;
  declare readonly maxLabel: string;
  declare readonly accept: string;
  declare readonly formatLabel: string;
  static from(): RequirementUploadPolicyResponseDto {
    return {
      maxBytes: SUBMISSION_UPLOAD_MAX_BYTES,
      maxLabel: SUBMISSION_UPLOAD_MAX_LABEL,
      accept: SUBMISSION_UPLOAD_ACCEPT,
      formatLabel: SUBMISSION_UPLOAD_FORMAT_LABEL,
    };
  }
}
export class RequirementListResponseDto {
  declare readonly documents: RequirementResponseDto[];
  declare readonly fileUpload: RequirementUploadPolicyResponseDto;
  static from(documents: RequirementResponseDto[]): RequirementListResponseDto {
    return {
      documents,
      fileUpload: RequirementUploadPolicyResponseDto.from(),
    };
  }
}
