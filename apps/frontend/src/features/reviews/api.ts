import { apiClient } from '@/lib/api-client';

import type {
  CreateReviewRequest,
  CreateReviewResponse,
  PublishRepositoryResponse,
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

export function publishRepository(
  repositoryId: string,
): Promise<PublishRepositoryResponse> {
  return apiClient<PublishRepositoryResponse>(
    `repositories/${repositoryId}/publish`,
    { method: 'POST' },
  );
}
