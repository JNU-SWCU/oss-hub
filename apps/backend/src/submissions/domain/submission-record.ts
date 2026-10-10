import type {
  ApplicationStatus,
  MilestoneSubmissionType,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';

export interface SubmissionApplication {
  readonly id: string;
  readonly programId: string;
  readonly teamId: string | null;

  readonly teamMemberCount: number;
  readonly status: ApplicationStatus;
  readonly existingSubmission: {
    readonly id: string;
    readonly status: SubmissionStatus;
  } | null;
}

interface ChecklistLatestReview {
  readonly decision: ReviewDecision;
  readonly reviewedAt: Date;
  readonly comment: string | null;
}

export interface SubmissionFileMetadata {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: Date;
  readonly downloadUrl: string;
}

export interface ChecklistMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly submission: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly currentRevision: number;
    readonly latestReview: ChecklistLatestReview | null;
    readonly file: SubmissionFileMetadata | null;
  } | null;
}
