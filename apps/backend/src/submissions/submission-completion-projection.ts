import {
  MilestoneDocumentKind,
  Prisma,
  type SubmissionStatus,
} from '@prisma/client';

/** Target-ledger fields required to project completion onto its two milestone axes. */
export const submissionCompletionTargetSelect = {
  status: true,
  milestoneDocument: {
    select: { id: true, milestoneId: true, kind: true },
  },
} as const satisfies Prisma.MilestoneDocumentSubmissionSelect;

export type SubmissionCompletionTargetRow =
  Prisma.MilestoneDocumentSubmissionGetPayload<{
    select: typeof submissionCompletionTargetSelect;
  }>;

export interface SubmissionCompletionProjections {
  /** Internal legacy submission slot, keyed by milestone. */
  readonly submissions: readonly {
    readonly milestoneId: string;
    readonly status: SubmissionStatus;
  }[];
  /** DOCUMENT submission slots, keyed by milestone document. */
  readonly documentSubmissions: readonly {
    readonly milestoneDocumentId: string;
    readonly status: SubmissionStatus;
  }[];
}

/**
 * Projects target-ledger completion rows onto the legacy milestone and DOCUMENT axes.
 *
 * `LEGACY_MILESTONE_SUBMISSION` is the permanent internal slot for a milestone's
 * former single-submission axis; it is never exposed as a document submission.
 */
export function projectSubmissionCompletionTargets(
  targetRows: readonly SubmissionCompletionTargetRow[],
): SubmissionCompletionProjections {
  const submissions: {
    milestoneId: string;
    status: SubmissionStatus;
  }[] = [];
  const documentSubmissions: {
    milestoneDocumentId: string;
    status: SubmissionStatus;
  }[] = [];

  for (const targetRow of targetRows) {
    switch (targetRow.milestoneDocument.kind) {
      case MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION:
        submissions.push({
          milestoneId: targetRow.milestoneDocument.milestoneId,
          status: targetRow.status,
        });
        break;
      case MilestoneDocumentKind.DOCUMENT:
        documentSubmissions.push({
          milestoneDocumentId: targetRow.milestoneDocument.id,
          status: targetRow.status,
        });
        break;
    }
  }

  return { submissions, documentSubmissions };
}
