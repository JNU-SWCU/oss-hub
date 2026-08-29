import { ReviewDecision } from '@prisma/client';
import { hasProgramDeadlinePassed } from '../../programs/program-deadline';

export type MilestoneDocumentSubmissionBlock =
  | 'MILESTONE_CLOSED'
  | 'SUBMISSION_REPLACEMENT_CLOSED'
  | 'RESUBMISSION_NOT_ALLOWED';

export function milestoneDocumentSubmissionBlock({
  dueAt,
  now,
  hasSubmission,
  latestDecision,
}: {
  readonly dueAt: Date;
  readonly now: Date;
  readonly hasSubmission: boolean;
  readonly latestDecision: ReviewDecision | null;
}): MilestoneDocumentSubmissionBlock | null {
  if (
    latestDecision === ReviewDecision.APPROVED ||
    latestDecision === ReviewDecision.REJECTED
  ) {
    return 'RESUBMISSION_NOT_ALLOWED';
  }
  if (latestDecision === ReviewDecision.CHANGES_REQUESTED) return null;
  if (!hasProgramDeadlinePassed(dueAt, now)) return null;
  return hasSubmission ? 'SUBMISSION_REPLACEMENT_CLOSED' : 'MILESTONE_CLOSED';
}
