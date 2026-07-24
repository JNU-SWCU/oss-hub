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
