import { apiClient } from '@/lib/api-client';
import { createRequirementReview } from '@/lib/requirement-review';
export { publishRepository } from '@/lib/repository-publication';
import type {
  CreateReviewRequest,
  CreateReviewResponse,
  ReviewContext,
} from './types';
export async function getReviewContext(
  submissionId: string,
): Promise<ReviewContext> {
  return apiClient<ReviewContext>(
    `submissions/${encodeURIComponent(submissionId)}/review-context`,
  );
}
export async function createReview(
  context: ReviewContext,
  request: CreateReviewRequest,
): Promise<CreateReviewResponse> {
  const review = await createRequirementReview(
    context.milestone.id,
    context.requirementId,
    context.application.id,
    {
      decision: request.decision,
      ...(request.comment === undefined ? {} : { comment: request.comment }),
      expectedRevision: request.revision,
      expectedLatestReviewId: context.latestReviewId,
    },
  );
  return { reviewId: review.id, submissionStatus: review.decision };
}
