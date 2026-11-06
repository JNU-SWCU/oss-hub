export type RequirementSubmissionStatus =
  'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
interface RequirementViewerReview {
  readonly comment: string | null;
  readonly reviewedAt: string;
}
export interface RequirementViewerSubmission {
  readonly submitted: boolean;
  readonly submittedAt: string | null;
  readonly submittedLate?: boolean;
  readonly revision: number | null;
  readonly status: RequirementSubmissionStatus | null;
  readonly hasCurrentFile: boolean;
  readonly currentFileName: string | null;
  readonly review: RequirementViewerReview | null;
  readonly history: {
    readonly hasHistory: boolean;
    readonly isComplete: boolean;
  };
}
interface RequirementTeamSubmissionCount {
  readonly submitted: number;
  readonly total: number;
}
export type RequirementSubmissionType = 'FILE' | 'TEXT' | 'FILE_OR_TEXT';
export interface Requirement {
  readonly id: string;
  readonly milestoneId: string;
  readonly name: string;
  readonly required: boolean;
  readonly submissionType: RequirementSubmissionType;
  readonly sortOrder: number;
  readonly graceDueAt?: string | null;
  readonly hasTemplateFile: boolean;
  readonly templateFileName: string | null;
  readonly viewerSubmission?: RequirementViewerSubmission;
  readonly teamSubmissionCount?: RequirementTeamSubmissionCount;
}
export interface UploadedRequirementFile {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}
export interface RequirementUploadPolicy {
  readonly maxBytes: number;
  readonly maxLabel: string;
  readonly accept: string;
  readonly formatLabel: string;
}
export type PreparedRequirementUpload = {
  readonly localId: string;
  readonly uploadId: string;
};
export interface RequirementList {
  readonly documents: readonly Requirement[];
  readonly fileUpload: RequirementUploadPolicy;
}
export interface Submission {
  readonly id: string;
  readonly status: string;
  readonly submittedAt: string;
}
export type SubmissionContent = {
  readonly text: string | null;
  readonly fileId: string | null;
};
