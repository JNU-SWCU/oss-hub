import type { MilestoneDocumentViewerResult } from '../milestone-document-result.types';
import { SubmissionStatus } from '@prisma/client';
import {
  SUBMISSION_UPLOAD_ACCEPT,
  SUBMISSION_UPLOAD_FORMAT_LABEL,
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
} from '../submission-file.policy';

export class MilestoneDocumentViewerReviewResponseDto {
  declare readonly comment: string | null;
  declare readonly reviewedAt: string;

  declare readonly resubmissionDueAt: string | null;

  static from(
    review: NonNullable<
      NonNullable<MilestoneDocumentViewerResult['viewerSubmission']>['review']
    >,
  ): MilestoneDocumentViewerReviewResponseDto {
    return {
      comment: review.comment,
      reviewedAt: review.reviewedAt.toISOString(),
      resubmissionDueAt: review.resubmissionDueAt?.toISOString() ?? null,
    };
  }
}

export class MilestoneDocumentViewerSubmissionResponseDto {
  declare readonly submitted: boolean;
  declare readonly submittedAt: string | null;
  declare readonly submittedLate: boolean;

  declare readonly revision: number | null;

  declare readonly status: SubmissionStatus | null;
  declare readonly hasCurrentFile: boolean;

  declare readonly currentFileName: string | null;

  declare readonly review: MilestoneDocumentViewerReviewResponseDto | null;

  declare readonly history: {
    readonly hasHistory: boolean;
    readonly isComplete: boolean;
  };

  static from(
    submission: NonNullable<MilestoneDocumentViewerResult['viewerSubmission']>,
  ): MilestoneDocumentViewerSubmissionResponseDto {
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
          : MilestoneDocumentViewerReviewResponseDto.from(submission.review),
      history: submission.history,
    };
  }
}

export class MilestoneDocumentTeamSubmissionCountResponseDto {
  declare readonly submitted: number;
  declare readonly total: number;

  static from(
    count: NonNullable<MilestoneDocumentViewerResult['teamSubmissionCount']>,
  ): MilestoneDocumentTeamSubmissionCountResponseDto {
    return { submitted: count.submitted, total: count.total };
  }
}

export class MilestoneDocumentResponseDto {
  declare readonly id: string;
  declare readonly milestoneId: string;
  declare readonly name: string;
  declare readonly required: boolean;
  declare readonly sortOrder: number;
  declare readonly graceDueAt: string | null;
  declare readonly hasTemplateFile: boolean;
  declare readonly templateFileName: string | null;

  declare readonly viewerSubmission?: MilestoneDocumentViewerSubmissionResponseDto;

  declare readonly teamSubmissionCount?: MilestoneDocumentTeamSubmissionCountResponseDto;

  static from(
    record: MilestoneDocumentViewerResult,
  ): MilestoneDocumentResponseDto {
    return {
      id: record.id,
      milestoneId: record.milestoneId,
      name: record.name,
      required: record.required,
      sortOrder: record.sortOrder,
      graceDueAt: record.graceDueAt?.toISOString() ?? null,
      hasTemplateFile: record.templateFileId !== null,
      templateFileName: record.templateFileName,
      viewerSubmission:
        record.viewerSubmission === undefined
          ? undefined
          : MilestoneDocumentViewerSubmissionResponseDto.from(
              record.viewerSubmission,
            ),
      teamSubmissionCount:
        record.teamSubmissionCount === undefined
          ? undefined
          : MilestoneDocumentTeamSubmissionCountResponseDto.from(
              record.teamSubmissionCount,
            ),
    };
  }
}

export class MilestoneDocumentUploadPolicyResponseDto {
  declare readonly maxBytes: number;

  declare readonly maxLabel: string;

  declare readonly accept: string;

  declare readonly formatLabel: string;

  static from(): MilestoneDocumentUploadPolicyResponseDto {
    return {
      maxBytes: SUBMISSION_UPLOAD_MAX_BYTES,
      maxLabel: SUBMISSION_UPLOAD_MAX_LABEL,
      accept: SUBMISSION_UPLOAD_ACCEPT,
      formatLabel: SUBMISSION_UPLOAD_FORMAT_LABEL,
    };
  }
}

export class MilestoneDocumentListResponseDto {
  declare readonly documents: MilestoneDocumentResponseDto[];
  declare readonly fileUpload: MilestoneDocumentUploadPolicyResponseDto;

  static from(
    documents: MilestoneDocumentResponseDto[],
  ): MilestoneDocumentListResponseDto {
    return {
      documents,
      fileUpload: MilestoneDocumentUploadPolicyResponseDto.from(),
    };
  }
}
