import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { hasProgramDeadlinePassed } from '../../programs/domain/program-deadline';

export type MilestoneDocumentSubmissionBlock =
  | 'MILESTONE_CLOSED'
  | 'SUBMISSION_REPLACEMENT_CLOSED'
  | 'RESUBMISSION_NOT_ALLOWED'
  | 'RESUBMISSION_ALREADY_USED'
  | 'RESUBMISSION_DUE_AT_PASSED';

export function hasMilestoneDocumentResubmissionDueAtPassed(
  resubmissionDueAt: Date | null,
  now: Date,
): boolean {
  if (resubmissionDueAt === null) return false;
  return hasProgramDeadlinePassed(resubmissionDueAt, now);
}

export function isChangeRequestResubmissionOpen({
  latestDecision,
  submissionStatus,
}: {
  readonly latestDecision: ReviewDecision | null;
  readonly submissionStatus: SubmissionStatus | null;
}): boolean {
  return (
    latestDecision === ReviewDecision.CHANGES_REQUESTED &&
    submissionStatus === SubmissionStatus.CHANGES_REQUESTED
  );
}

export function isPostDeadlineResubmissionOpen({
  latestDecision,
  submissionStatus,
  resubmissionDueAt,
  now,
}: {
  readonly latestDecision: ReviewDecision | null;
  readonly submissionStatus: SubmissionStatus | null;
  readonly resubmissionDueAt: Date | null;
  readonly now: Date;
}): boolean {
  return (
    isChangeRequestResubmissionOpen({ latestDecision, submissionStatus }) &&
    !hasMilestoneDocumentResubmissionDueAtPassed(resubmissionDueAt, now)
  );
}

export function milestoneDocumentSubmissionBlock({
  dueAt,
  now,
  hasSubmission,
  latestDecision,
  submissionStatus,
  resubmissionDueAt,
}: {
  readonly dueAt: Date;
  readonly now: Date;
  readonly hasSubmission: boolean;
  readonly latestDecision: ReviewDecision | null;

  readonly submissionStatus: SubmissionStatus | null;

  readonly resubmissionDueAt: Date | null;
}): MilestoneDocumentSubmissionBlock | null {
  if (
    latestDecision === ReviewDecision.APPROVED ||
    latestDecision === ReviewDecision.REJECTED
  ) {
    return 'RESUBMISSION_NOT_ALLOWED';
  }
  if (!hasProgramDeadlinePassed(dueAt, now)) return null;
  if (
    isPostDeadlineResubmissionOpen({
      latestDecision,
      submissionStatus,
      resubmissionDueAt,
      now,
    })
  ) {
    return null;
  }

  if (isChangeRequestResubmissionOpen({ latestDecision, submissionStatus })) {
    return 'RESUBMISSION_DUE_AT_PASSED';
  }

  if (latestDecision === ReviewDecision.CHANGES_REQUESTED && hasSubmission) {
    return 'RESUBMISSION_ALREADY_USED';
  }
  return hasSubmission ? 'SUBMISSION_REPLACEMENT_CLOSED' : 'MILESTONE_CLOSED';
}
