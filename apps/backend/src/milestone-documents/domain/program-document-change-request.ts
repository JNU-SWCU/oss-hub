import { SubmissionStatus } from '@prisma/client';

export type ProgramDocumentChangeRequestScope =
  | { readonly kind: 'PROGRAM' }
  | { readonly kind: 'TEAM'; readonly teamId: string };

export interface ProgramDocumentChangeRequestInput {
  readonly scope: ProgramDocumentChangeRequestScope;
  readonly includeFinalDecisions: boolean;
  readonly comment: string;
  readonly resubmissionDueAt: Date;
  readonly expectedCount: number;
}

export type ProgramDocumentChangeRequestTargetCounts = Readonly<
  Record<SubmissionStatus, number>
>;

const OPEN_STATUSES: readonly SubmissionStatus[] = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.CHANGES_REQUESTED,
];

const FINAL_STATUSES: readonly SubmissionStatus[] = [
  SubmissionStatus.APPROVED,
  SubmissionStatus.REJECTED,
];

export function changeRequestTargetStatuses(
  includeFinalDecisions: boolean,
): readonly SubmissionStatus[] {
  return includeFinalDecisions
    ? [...OPEN_STATUSES, ...FINAL_STATUSES]
    : OPEN_STATUSES;
}
