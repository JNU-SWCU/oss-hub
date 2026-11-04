import { apiClient } from '@/lib/api-client';
import { createMilestoneDocumentReview } from '@/lib/requirement-review';
export { publishRepository } from '@/lib/repository-publication';

import type {
  CreateReviewRequest,
  CreateReviewResponse,
  ReviewContext,
} from './types';

export async function getReviewContext(
  submissionId: string,
): Promise<ReviewContext> {
  const context = await apiClient<Omit<ReviewContext, 'requirementId'>>(
    `submissions/${encodeURIComponent(submissionId)}/review-context`,
  );
  const { documents } = await apiClient<{
    readonly documents: readonly {
      readonly id: string;
      readonly submissionType: string;
    }[];
  }>(
    `milestones/${encodeURIComponent(context.milestone.id)}/documents?scope=all`,
  );
  const [requirement, ...otherMatches] = documents.filter(
    (document) =>
      document.submissionType === context.currentRevision.content.type,
  );
  if (requirement === undefined || otherMatches.length !== 0)
    throw new TypeError('Invalid requirement for legacy review link');
  return { ...context, requirementId: requirement.id };
}

export async function createReview(
  context: ReviewContext,
  request: CreateReviewRequest,
): Promise<CreateReviewResponse> {
  const review = await createMilestoneDocumentReview(
    context.milestone.id,
    context.requirementId,
    context.application.id,
    {
      decision: request.decision,
      ...(request.comment === undefined ? {} : { comment: request.comment }),
      expectedRevision: request.revision,
      expectedLatestReviewId: context.currentRevision.review?.id ?? null,
    },
  );
  return { reviewId: review.id, submissionStatus: review.decision };
}
