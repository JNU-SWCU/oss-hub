import { SubmissionStatus } from '@prisma/client';
import type { MilestoneSubmissionType, ReviewDecision } from '@prisma/client';
import { hasProgramDeadlinePassed } from '../../programs/domain/program-deadline';
import type {
  ChecklistMilestone,
  SubmissionApplication,
  SubmissionFileMetadata,
} from './submission-record';

export type SubmissionBlockedReason =
  'SUBMISSION_ALREADY_EXISTS' | 'MILESTONE_CLOSED';

export interface SubmissionFormResult {
  readonly applicationId: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly milestone: {
    readonly id: string;
    readonly name: string;
    readonly dueAt: Date;
    readonly dDay: number;
    readonly deadlineLabel: string;
    readonly submissionType: MilestoneSubmissionType;
    readonly instructions: string | null;
  };
  readonly existingSubmission: SubmissionApplication['existingSubmission'];
  readonly canSubmit: boolean;
  readonly blockedReason: SubmissionBlockedReason | null;
}

export interface CreatedSubmissionResult {
  readonly submissionId: string;
  readonly status: SubmissionStatus;
  readonly submittedAt: Date;
}

export interface ResubmittedSubmissionResult {
  readonly submissionId: string;
  readonly revision: number;
  readonly status: SubmissionStatus;
}

export interface SubmissionChecklistItemResult {
  readonly milestoneId: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly submission: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly currentRevision: number;
    readonly decision: ReviewDecision | null;
    readonly lastReviewedAt: Date | null;
    readonly reviewComment: string | null;
    readonly canResubmit: boolean;
    readonly file: SubmissionFileMetadata | null;
  } | null;
}

export interface SubmissionChecklistResult {
  readonly applicationId: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly items: readonly SubmissionChecklistItemResult[];
}

export function submissionChecklistItem(
  milestone: ChecklistMilestone,
  now: Date,
): SubmissionChecklistItemResult {
  return {
    milestoneId: milestone.id,
    name: milestone.name,
    dueAt: milestone.dueAt,
    submissionType: milestone.submissionType,
    submission: milestone.submission
      ? {
          id: milestone.submission.id,
          status: milestone.submission.status,
          currentRevision: milestone.submission.currentRevision,
          decision: milestone.submission.latestReview?.decision ?? null,
          lastReviewedAt: milestone.submission.latestReview?.reviewedAt ?? null,
          reviewComment: milestone.submission.latestReview?.comment ?? null,
          canResubmit:
            milestone.submission.status ===
              SubmissionStatus.CHANGES_REQUESTED ||
            (milestone.submission.status === SubmissionStatus.SUBMITTED &&
              !hasProgramDeadlinePassed(milestone.dueAt, now)),
          file: milestone.submission.file,
        }
      : null,
  };
}
