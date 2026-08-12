import { apiClient } from '@/lib/api-client';
export { publishRepository } from '@/lib/repository-publication';

import type {
  CreateReviewRequest,
  CreateReviewResponse,
  ReviewContext,
} from './types';

export function getReviewContext(submissionId: string): Promise<ReviewContext> {
  return apiClient<ReviewContext>(`submissions/${submissionId}/review-context`);
}

export function createReview(
  submissionId: string,
  request: CreateReviewRequest,
): Promise<CreateReviewResponse> {
  return apiClient<CreateReviewResponse>(
    `submissions/${submissionId}/reviews`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
  );
}
