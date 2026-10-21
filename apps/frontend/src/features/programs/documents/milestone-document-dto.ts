export type MilestoneDocumentSubmissionStatus =
  'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

interface MilestoneDocumentViewerReview {
  readonly comment: string | null;
  readonly reviewedAt: string;

  readonly resubmissionDueAt: string | null;
}

export interface MilestoneDocumentViewerSubmission {
  readonly submitted: boolean;
  readonly submittedAt: string | null;
  readonly submittedLate?: boolean;

  readonly revision: number | null;

  readonly status: MilestoneDocumentSubmissionStatus | null;
  readonly hasCurrentFile: boolean;

  readonly currentFileName: string | null;

  readonly review: MilestoneDocumentViewerReview | null;

  readonly history: {
    readonly hasHistory: boolean;
    readonly isComplete: boolean;
  };
}

interface MilestoneDocumentTeamSubmissionCount {
  readonly submitted: number;
  readonly total: number;
}

export interface MilestoneDocument {
  readonly id: string;
  readonly milestoneId: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly graceDueAt?: string | null;
  readonly hasTemplateFile: boolean;
  readonly templateFileName: string | null;

  readonly viewerSubmission?: MilestoneDocumentViewerSubmission;

  readonly teamSubmissionCount?: MilestoneDocumentTeamSubmissionCount;
}

export interface UploadedMilestoneDocumentFile {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}

export interface MilestoneDocumentUploadPolicy {
  readonly maxBytes: number;

  readonly maxLabel: string;

  readonly accept: string;

  readonly formatLabel: string;
}

export type PreparedMilestoneDocumentUpload = {
  readonly localId: string;
  readonly uploadId: string;
};

export interface MilestoneDocumentList {
  readonly documents: readonly MilestoneDocument[];
  readonly fileUpload: MilestoneDocumentUploadPolicy;
}

export interface MilestoneDocumentSubmission {
  readonly id: string;
  readonly status: string;
  readonly submittedAt: string;
}

export type MilestoneDocumentSubmissionContent = {
  readonly text: string | null;
  readonly fileId: string | null;
};
