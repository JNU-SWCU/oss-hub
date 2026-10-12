import { createHash } from 'node:crypto';
import { SubmissionStatus } from '@prisma/client';

export type ProgramDocumentChangeRequestScope =
  | { readonly kind: 'PROGRAM' }
  | { readonly kind: 'TEAM'; readonly teamId: string };

export interface ProgramDocumentChangeRequestInput {
  readonly scope: ProgramDocumentChangeRequestScope;
  readonly includeFinalDecisions: boolean;
  readonly comment: string;
  readonly resubmissionDueAt: Date;
  readonly expectedVersion: string;
}

export interface ProgramDocumentChangeRequestCandidate {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly status: SubmissionStatus;
}

export interface ProgramDocumentChangeRequestPreview {
  readonly counts: Readonly<Record<SubmissionStatus, number>>;
  readonly version: string;
}

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

export function changeRequestTargetsVersion(
  candidates: readonly ProgramDocumentChangeRequestCandidate[],
): string {
  const lines = candidates
    .map(
      (candidate) =>
        `${candidate.milestoneDocumentId}:${candidate.applicationId}:${
          OPEN_STATUSES.includes(candidate.status) ? 'open' : 'final'
        }`,
    )
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}
