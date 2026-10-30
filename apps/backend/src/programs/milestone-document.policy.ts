import {
  MilestoneSubmissionType,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.error';
import { createHash } from 'node:crypto';

export type DocumentDeliveryStatus =
  'MISSING' | 'LATE' | 'COMPLETE' | 'NO_REQUIRED_ITEMS';

export function documentDeliveryStatus(input: {
  readonly requiredFirstSubmissions: readonly (Date | null)[];
  readonly dueAt: Date | null;
}): DocumentDeliveryStatus {
  if (input.requiredFirstSubmissions.length === 0) return 'NO_REQUIRED_ITEMS';
  if (
    input.requiredFirstSubmissions.some((submittedAt) => submittedAt === null)
  )
    return 'MISSING';
  const dueAt = input.dueAt;
  if (
    dueAt !== null &&
    input.requiredFirstSubmissions.some(
      (submittedAt) => submittedAt !== null && submittedAt > dueAt,
    )
  )
    return 'LATE';
  return 'COMPLETE';
}

export type MilestoneDocumentContentInput = {
  readonly text: string | null;
  readonly fileId: string | null;
};

export type MilestoneDocumentSubmittedContent = {
  readonly type: typeof MilestoneSubmissionType.TEXT;
  readonly text: string;
};

export function readMilestoneDocumentSubmittedContent(
  stored: unknown,
): MilestoneDocumentSubmittedContent | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const content = stored as Record<string, unknown>;
  switch (content.type) {
    case MilestoneSubmissionType.TEXT:
      return typeof content.text === 'string'
        ? { type: MilestoneSubmissionType.TEXT, text: content.text }
        : null;
    default:
      return null;
  }
}

export function parseMilestoneDocumentContent(input: {
  readonly fileId?: string;
  readonly text?: string;
}): MilestoneDocumentContentInput {
  const text = input.text?.trim() || null;
  const fileId = input.fileId?.trim() || null;
  if (text === null && fileId === null) throw contentRequired();
  return { text, fileId };
}

function contentRequired(): DomainException {
  return new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[
      MilestoneDocumentsErrorCode.CONTENT_REQUIRED
    ],
  );
}

export interface CreateMilestoneDocumentReviewInput {
  readonly decision: ReviewDecision;
  readonly comment: string | null;

  readonly resubmissionDueAt: Date | null;

  readonly expectedRevision: number;

  readonly expectedLatestReviewId: string | null;
}

export interface MilestoneDocumentReviewRecord {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;

  readonly resubmissionDueAt: Date | null;
}

export function reviewDecisionToSubmissionStatus(
  decision: ReviewDecision,
): SubmissionStatus {
  switch (decision) {
    case ReviewDecision.APPROVED:
      return SubmissionStatus.APPROVED;
    case ReviewDecision.CHANGES_REQUESTED:
      return SubmissionStatus.CHANGES_REQUESTED;
    case ReviewDecision.REJECTED:
      return SubmissionStatus.REJECTED;
  }
}

export function isResubmissionAllowedAfter(
  latestDecision: ReviewDecision | null,
): boolean {
  if (latestDecision === null) return true;
  switch (latestDecision) {
    case ReviewDecision.APPROVED:
    case ReviewDecision.REJECTED:
      return false;
    case ReviewDecision.CHANGES_REQUESTED:
      return true;
  }
}

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
