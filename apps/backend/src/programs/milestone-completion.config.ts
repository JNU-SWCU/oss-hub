import { SubmissionStatus } from '@prisma/client';

export type MilestoneCompletionStatus = SubmissionStatus | 'NOT_SUBMITTED';

export const MILESTONE_NOT_SUBMITTED = 'NOT_SUBMITTED' as const;

export interface MilestoneCompletionInput {
  readonly submissionAxisInUse?: boolean;

  readonly requiredDocumentStatuses: readonly (SubmissionStatus | null)[];

  readonly submissionStatus: SubmissionStatus | null;
}
