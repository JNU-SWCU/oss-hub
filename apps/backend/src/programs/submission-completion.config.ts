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
