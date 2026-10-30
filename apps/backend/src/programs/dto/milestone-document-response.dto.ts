import type { MilestoneDocumentViewerResult } from '../milestone-document-result.types';
import { SubmissionStatus } from '@prisma/client';
import {
  SUBMISSION_UPLOAD_ACCEPT,
  SUBMISSION_UPLOAD_FORMAT_LABEL,
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
} from '../submission-upload.policy';
import type { MilestoneDocumentRecord } from '../milestone-document-record.types';

interface MilestoneDocumentViewerReviewResponseDto {
  readonly comment: string | null;
  readonly reviewedAt: string;

  readonly resubmissionDueAt: string | null;
}

export interface MilestoneDocumentViewerSubmissionResponseDto {
  readonly submitted: boolean;
  readonly submittedAt: string | null;
  readonly submittedLate: boolean;

  readonly revision: number | null;

  readonly status: SubmissionStatus | null;
  readonly hasCurrentFile: boolean;

  readonly currentFileName: string | null;

  readonly review: MilestoneDocumentViewerReviewResponseDto | null;

  readonly history: {
    readonly hasHistory: boolean;
    readonly isComplete: boolean;
  };
}

export interface MilestoneDocumentTeamSubmissionCountResponseDto {
  readonly submitted: number;
  readonly total: number;
}

export interface MilestoneDocumentViewerResponseDto {
  readonly viewerSubmission?: MilestoneDocumentViewerSubmissionResponseDto;
  readonly teamSubmissionCount?: MilestoneDocumentTeamSubmissionCountResponseDto;
}

export class MilestoneDocumentResponseDto {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  sortOrder: number;
  graceDueAt: string | null;
  hasTemplateFile: boolean;
  templateFileName: string | null;

  viewerSubmission?: MilestoneDocumentViewerSubmissionResponseDto;

  teamSubmissionCount?: MilestoneDocumentTeamSubmissionCountResponseDto;

  private constructor(
    record: MilestoneDocumentRecord,
    viewer: MilestoneDocumentViewerResponseDto,
  ) {
    this.id = record.id;
    this.milestoneId = record.milestoneId;
    this.name = record.name;
    this.required = record.required;
    this.sortOrder = record.sortOrder;
    this.graceDueAt = record.graceDueAt?.toISOString() ?? null;
    this.hasTemplateFile = record.templateFileId !== null;
    this.templateFileName = record.templateFileName;
    this.viewerSubmission = viewer.viewerSubmission;
    this.teamSubmissionCount = viewer.teamSubmissionCount;
  }

  static from(
    record: MilestoneDocumentRecord,
    viewer: MilestoneDocumentViewerResponseDto = {},
  ): MilestoneDocumentResponseDto {
    return new MilestoneDocumentResponseDto(record, viewer);
  }
}

export class MilestoneDocumentUploadPolicyResponseDto {
  maxBytes: number;

  maxLabel: string;

  accept: string;

  formatLabel: string;

  private constructor() {
    this.maxBytes = SUBMISSION_UPLOAD_MAX_BYTES;
    this.maxLabel = SUBMISSION_UPLOAD_MAX_LABEL;
    this.accept = SUBMISSION_UPLOAD_ACCEPT;
    this.formatLabel = SUBMISSION_UPLOAD_FORMAT_LABEL;
  }

  static current(): MilestoneDocumentUploadPolicyResponseDto {
    return new MilestoneDocumentUploadPolicyResponseDto();
  }
}

export class MilestoneDocumentListResponseDto {
  documents: MilestoneDocumentResponseDto[];
  fileUpload: MilestoneDocumentUploadPolicyResponseDto;

  private constructor(documents: MilestoneDocumentResponseDto[]) {
    this.documents = documents;
    this.fileUpload = MilestoneDocumentUploadPolicyResponseDto.current();
  }

  static from(
    documents: MilestoneDocumentResponseDto[],
  ): MilestoneDocumentListResponseDto {
    return new MilestoneDocumentListResponseDto(documents);
  }
}

export function presentMilestoneDocumentViewer(
  result: MilestoneDocumentViewerResult,
): MilestoneDocumentResponseDto {
  const submission = result.viewerSubmission;
  return MilestoneDocumentResponseDto.from(result, {
    teamSubmissionCount: result.teamSubmissionCount,
    viewerSubmission:
      submission === undefined
        ? undefined
        : {
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
                : {
                    comment: submission.review.comment,
                    reviewedAt: submission.review.reviewedAt.toISOString(),
                    resubmissionDueAt:
                      submission.review.resubmissionDueAt?.toISOString() ??
                      null,
                  },
            history: submission.history,
          },
  });
}
