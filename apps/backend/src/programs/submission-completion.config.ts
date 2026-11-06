import type { SubmissionStatus } from '@prisma/client';
export interface SubmissionCompletionTargetRow {
  readonly status: SubmissionStatus;
  readonly requirement: {
    readonly id: string;
    readonly milestoneId: string;
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
