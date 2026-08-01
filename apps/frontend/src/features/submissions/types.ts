export type SubmissionType = 'FILE' | 'TEXT' | 'REPOSITORY_RELEASE';

export type SubmissionBlockedReason =
  | 'SUBMISSION_ALREADY_EXISTS'
  | 'MILESTONE_CLOSED'
  | 'REPOSITORY_NOT_READY'
  | 'FILE_UPLOAD_UNAVAILABLE';

export interface SubmissionFormData {
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
  readonly repository: {
    readonly url: string;
    readonly status: 'READY';
  } | null;
  readonly existingSubmission: {
    readonly id: string;
    readonly status:
      'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
    readonly checklistUrl: string;
  } | null;
  readonly canSubmit: boolean;
  readonly blockedReason: SubmissionBlockedReason | null;
}

export type TextSubmissionContent = {
  readonly type: 'TEXT';
  readonly text: string;
};

export type RepositoryReleaseSubmissionContent = {
  readonly type: 'REPOSITORY_RELEASE';
  readonly releaseUrl: string;
};

export type CreateSubmissionContent =
  | { readonly type: 'FILE'; readonly fileId: string }
  | TextSubmissionContent
  | RepositoryReleaseSubmissionContent;

export type ResubmissionContent =
  | { readonly type: 'FILE'; readonly fileId: string }
  | TextSubmissionContent
  | RepositoryReleaseSubmissionContent;

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

// ── #116 제출 체크리스트 ────────────────────────────────────────────────

/** 저장되는 Submission 상태 — 미제출은 submission=null로 표현된다. */
export type ChecklistSubmissionStatus =
  'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export interface ChecklistSubmission {
  readonly id: string;
  readonly status: ChecklistSubmissionStatus;
  readonly currentRevision: number;
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
  readonly applicationId: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly items: readonly SubmissionChecklistItem[];
}

export interface CreatedResubmission {
  readonly submissionId: string;
  readonly revision: number;
  readonly status: 'SUBMITTED';
}

// #124 제출 현황 매트릭스 — GET /programs/{programId}/submissions/matrix 계약.

export type MatrixApplicationMode = 'PERSONAL' | 'TEAM';

export type MatrixCellStatus =
  'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export interface MatrixMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
}

/** 미제출 cell은 submissionId·revision·submittedAt·reviewUrl이 모두 null이다. */
export interface MatrixCell {
  readonly milestoneId: string;
  readonly submissionId: string | null;
  readonly revision: number | null;
  readonly status: MatrixCellStatus;
  readonly submittedAt: string | null;
  readonly reviewUrl: string | null;
}

/** 행은 팀이 아니라 승인된 Application이다(#124 계약 잠금). */
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
