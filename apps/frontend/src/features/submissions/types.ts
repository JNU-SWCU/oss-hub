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

export type CreateSubmissionContent =
  | { readonly type: 'TEXT'; readonly text: string }
  | {
      readonly type: 'REPOSITORY_RELEASE';
      readonly releaseUrl: string;
    };

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
