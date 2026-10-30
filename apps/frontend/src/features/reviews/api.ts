import { apiClient } from '@/lib/api-client';
export { publishRepository } from '@/lib/repository-publication';

import type {
  CreateReviewRequest,
  CreateReviewResponse,
  ReviewContext,
} from './types';

export function getReviewContext(submissionId: string): Promise<ReviewContext> {
  return apiClient<ReviewContext>(
    `submissions/${encodeURIComponent(submissionId)}/review-context`,
  );
}

export function createReview(
  submissionId: string,
  request: CreateReviewRequest,
): Promise<CreateReviewResponse> {
  return apiClient<CreateReviewResponse>(
    `submissions/${encodeURIComponent(submissionId)}/reviews`,
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
  );
}
