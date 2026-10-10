import { MilestoneDocumentKind, type SubmissionStatus } from '@prisma/client';

export const submissionCompletionTargetSelect = {
  status: true,
  milestoneDocument: {
    select: { id: true, milestoneId: true, kind: true },
  },
} as const;

export interface SubmissionCompletionTargetRow {
  readonly status: SubmissionStatus;
  readonly milestoneDocument: {
    readonly id: string;
    readonly milestoneId: string;
    readonly kind: MilestoneDocumentKind;
  };
}

export interface SubmissionCompletionProjections {
  readonly submissions: readonly {
    readonly milestoneId: string;
    readonly status: SubmissionStatus;
  }[];

  readonly documentSubmissions: readonly {
    readonly milestoneDocumentId: string;
    readonly status: SubmissionStatus;
  }[];
}

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
