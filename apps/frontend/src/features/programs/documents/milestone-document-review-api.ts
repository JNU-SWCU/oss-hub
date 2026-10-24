import { apiClient } from '@/lib/api-client';
import type {
  MilestoneDocumentReviewInput,
  CreatedMilestoneDocumentReview,
} from './milestone-document-review-dto';

export const MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH = 2_000;

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
      body: JSON.stringify(input),
    },
  );
}
