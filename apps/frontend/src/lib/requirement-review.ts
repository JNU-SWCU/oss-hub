import { apiClient } from './api-client';
export const MILESTONE_DOCUMENT_REVIEW_DECISIONS = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
] as const;
export type MilestoneDocumentReviewDecision =
  (typeof MILESTONE_DOCUMENT_REVIEW_DECISIONS)[number];
export interface MilestoneDocumentReviewInput {
  readonly decision: MilestoneDocumentReviewDecision;
  readonly comment?: string;
  readonly expectedRevision: number;
  readonly expectedLatestReviewId: string | null;
}
export interface CreatedMilestoneDocumentReview {
  readonly id: string;
  readonly decision: MilestoneDocumentReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;
  readonly reviewerNickname: string;
}
export const MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH = 2000;
function reviewsPath(
  milestoneId: string,
  documentId: string,
  teamId: string,
): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents/${encodeURIComponent(documentId)}/teams/${encodeURIComponent(teamId)}/reviews`;
}
export function createMilestoneDocumentReview(
  milestoneId: string,
  documentId: string,
  teamId: string,
  input: MilestoneDocumentReviewInput,
): Promise<CreatedMilestoneDocumentReview> {
  return apiClient<CreatedMilestoneDocumentReview>(
    reviewsPath(milestoneId, documentId, teamId),
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}
export function milestoneDocumentReviewFormError(
  decision: MilestoneDocumentReviewDecision | null,
  comment: string,
): string | null {
  if (decision === null) return '승인, 보완 요청, 반려 중 하나를 골라 주세요.';
  if (comment.length > MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH) {
    return '사유는 2,000자까지 쓸 수 있습니다.';
  }
  return null;
}
