import { apiClient } from './api-client';
export const REQUIREMENT_REVIEW_DECISIONS = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
] as const;
export type RequirementReviewDecision =
  (typeof REQUIREMENT_REVIEW_DECISIONS)[number];
export interface RequirementReviewInput {
  readonly decision: RequirementReviewDecision;
  readonly comment?: string;
  readonly expectedRevision: number;
  readonly expectedLatestReviewId: string | null;
}
export interface CreatedRequirementReview {
  readonly id: string;
  readonly decision: RequirementReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;
  readonly reviewerNickname: string;
}
export const REQUIREMENT_REVIEW_COMMENT_MAX_LENGTH = 2000;
function reviewsPath(
  milestoneId: string,
  documentId: string,
  teamId: string,
): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents/${encodeURIComponent(documentId)}/teams/${encodeURIComponent(teamId)}/reviews`;
}
export function createRequirementReview(
  milestoneId: string,
  documentId: string,
  teamId: string,
  input: RequirementReviewInput,
): Promise<CreatedRequirementReview> {
  return apiClient<CreatedRequirementReview>(
    reviewsPath(milestoneId, documentId, teamId),
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}
export function requirementReviewFormError(
  decision: RequirementReviewDecision | null,
  comment: string,
): string | null {
  if (decision === null) return '승인, 보완 요청, 반려 중 하나를 골라 주세요.';
  if (comment.length > REQUIREMENT_REVIEW_COMMENT_MAX_LENGTH) {
    return '사유는 2,000자까지 쓸 수 있습니다.';
  }
  return null;
}
