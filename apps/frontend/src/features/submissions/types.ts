import type { DocumentDeliveryStatus } from '@/lib/document-delivery';
import type { SubmissionUploadLimit } from '@/lib/submission-upload-policy';

export type SubmissionType = 'FILE' | 'TEXT';

export type SubmissionBlockedReason =
  'SUBMISSION_ALREADY_EXISTS' | 'MILESTONE_CLOSED' | 'FILE_UPLOAD_UNAVAILABLE';

export interface SubmissionFormData {
  readonly fileUpload: SubmissionUploadLimit;
  readonly applicationId: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly milestone: {
    readonly id: string;
    readonly name: string;
    readonly dueAt: string;
    readonly dDay: number;
    readonly deadlineLabel: string;
    readonly submissionType: SubmissionType;
    readonly instructions: string | null;
  };
  readonly existingSubmission: {
    readonly id: string;
    readonly status:
      'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
    readonly checklistUrl: string;
  } | null;
  readonly canSubmit: boolean;
  readonly blockedReason: SubmissionBlockedReason | null;
}

type TextSubmissionContent = {
  readonly type: 'TEXT';
  readonly text: string;
};

export type CreateSubmissionContent =
  { readonly type: 'FILE'; readonly fileId: string } | TextSubmissionContent;

export type ResubmissionContent =
  { readonly type: 'FILE'; readonly fileId: string } | TextSubmissionContent;

export interface SubmissionFileMetadata {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
  readonly downloadUrl: string;
}

export interface UploadedSubmissionFile {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}

export interface CreatedSubmission {
  readonly submissionId: string;
  readonly status: 'SUBMITTED';
  readonly submittedAt: string;
}

export type ChecklistSubmissionStatus =
  'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
type ChecklistReviewDecision = 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

export interface ChecklistSubmission {
  readonly id: string;
  readonly status: ChecklistSubmissionStatus;
  readonly currentRevision: number;
  readonly decision: ChecklistReviewDecision | null;
  readonly lastReviewedAt: string | null;
  readonly reviewComment: string | null;
  readonly canResubmit: boolean;
  readonly file: SubmissionFileMetadata | null;
}

export interface SubmissionChecklistItem {
  readonly milestoneId: string;
  readonly name: string;
  readonly dueAt: string;
  readonly submissionType: SubmissionType;
  readonly submission: ChecklistSubmission | null;
}

export interface SubmissionChecklist {
  readonly fileUpload: SubmissionUploadLimit;
  readonly applicationId: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly items: readonly SubmissionChecklistItem[];
}

export interface MilestoneDocumentCurrentFileItem {
  readonly id: string;
  readonly name: string;
  readonly viewerSubmission?: {
    readonly submitted: boolean;
    readonly hasCurrentFile: boolean;
  };
}

export interface CreatedResubmission {
  readonly submissionId: string;
  readonly revision: number;
  readonly status: 'SUBMITTED';
}

export type MatrixApplicationMode = 'PERSONAL' | 'TEAM';

type MatrixCellStatus =
  'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export interface MatrixMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
}

export interface MatrixCell {
  readonly deliveryStatus: DocumentDeliveryStatus;
  readonly milestoneId: string;
  readonly submissionId: string | null;
  readonly revision: number | null;
  readonly status: MatrixCellStatus;
  readonly submittedAt: string | null;
  readonly reviewUrl: string | null;
}

export interface MatrixRow {
  readonly applicationId: string;
  readonly applicationMode: MatrixApplicationMode;
  readonly displayName: string;
  readonly githubLogins: readonly string[];
  readonly cells: readonly MatrixCell[];
}

export interface SubmissionMatrixPage {
  readonly milestones: readonly MatrixMilestone[];
  readonly rows: readonly MatrixRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}
