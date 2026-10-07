import { apiClient } from '@/lib/api-client';

export const MILESTONE_DOCUMENT_REVIEW_DECISIONS = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
] as const;

export type MilestoneDocumentReviewDecision =
  (typeof MILESTONE_DOCUMENT_REVIEW_DECISIONS)[number];

export const MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH = 2_000;

export interface MilestoneDocumentReviewInput {
  readonly decision: MilestoneDocumentReviewDecision;

  readonly comment?: string;

  readonly resubmissionDueAt?: string;

  readonly expectedRevision: number;

  readonly expectedLatestReviewId: string | null;
}

export interface CreatedMilestoneDocumentReview {
  readonly id: string;
  readonly decision: MilestoneDocumentReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;

  readonly resubmissionDueAt: string | null;

  readonly reviewerNickname: string;
}

export const MILESTONE_DOCUMENT_REVIEW_ERROR_CODES = {
  COMMENT_REQUIRED: 'MSD_021',
  SUBMISSION_NOT_FOUND: 'MSD_022',
  REVIEW_CHANGED: 'MSD_024',
  REVIEW_TARGET_CHANGED: 'MSD_025',
  RESUBMISSION_DUE_AT_REQUIRED: 'MSD_032',
  RESUBMISSION_DUE_AT_NOT_FUTURE: 'MSD_033',
} as const;

function reviewsPath(
  milestoneId: string,
  documentId: string,
  applicationId: string,
): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents/${encodeURIComponent(documentId)}/applications/${encodeURIComponent(applicationId)}/reviews`;
}

export function createMilestoneDocumentReview(
  milestoneId: string,
  documentId: string,
  applicationId: string,
  input: MilestoneDocumentReviewInput,
): Promise<CreatedMilestoneDocumentReview> {
  return apiClient<CreatedMilestoneDocumentReview>(
    reviewsPath(milestoneId, documentId, applicationId),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}
