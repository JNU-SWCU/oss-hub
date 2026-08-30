import type {
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  ReviewDecision,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';

export interface LegacyTargetHeaderIdentity {
  readonly id: string;
  readonly legacySubmissionId: string | null;
}

export interface LegacyTargetSubmissionRecord extends LegacyTargetHeaderIdentity {
  readonly publicSubmissionId: string;
  readonly applicationId: string;
  readonly milestoneId: string;
  readonly revision: number;
  readonly status: SubmissionStatus;
  readonly content: Prisma.JsonValue | null;
  readonly submittedById: string;
  readonly submittedAt: Date;
}

export interface LegacyTargetHistoryFile {
  readonly id: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly lifecycle: SubmissionFileLifecycle;
  readonly expiresAt: Date | null;
}

export interface LegacyTargetHistoryReview {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}

export interface LegacyTargetHistoryRecord {
  readonly id: string;
  readonly event: MilestoneDocumentSubmissionHistoryEvent;
  readonly revision: number | null;
  readonly content: Prisma.JsonValue | null;
  readonly comment: string | null;
  readonly createdAt: Date;
  readonly files: readonly LegacyTargetHistoryFile[];
  readonly reviews: readonly LegacyTargetHistoryReview[];
}

export interface LegacyTargetSubmissionHistory {
  readonly submission: LegacyTargetSubmissionRecord;
  readonly histories: readonly LegacyTargetHistoryRecord[];
}

export class LegacySubmissionPublicIdCollisionError extends Error {
  override readonly name = 'LegacySubmissionPublicIdCollisionError';
}

export function requiredLegacySubmissionPublicId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new TypeError('Invalid legacy submission public id');
  }
  return value;
}

export function publicLegacySubmissionId(
  header: LegacyTargetHeaderIdentity,
): string {
  return header.legacySubmissionId ?? header.id;
}
