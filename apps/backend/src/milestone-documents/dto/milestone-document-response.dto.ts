import { SubmissionStatus } from '@prisma/client';
import {
  SUBMISSION_UPLOAD_ACCEPT,
  SUBMISSION_UPLOAD_FORMAT_LABEL,
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
} from '../../submissions/domain/submission-upload-policy';
import type { MilestoneDocumentRecord } from '../domain/milestone-document-record';

export interface MilestoneDocumentViewerReviewResponseDto {
  readonly comment: string | null;
  readonly reviewedAt: string;

  readonly resubmissionDueAt: string | null;
}

export interface MilestoneDocumentViewerSubmissionResponseDto {
  readonly submitted: boolean;
  readonly submittedAt: string | null;

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
