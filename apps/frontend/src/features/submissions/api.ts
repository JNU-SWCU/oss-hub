import { apiClient } from '@/lib/api-client';
import type {
  CreatedSubmission,
  CreateSubmissionContent,
  SubmissionFormData,
} from './types';

export function getSubmissionForm(
  programId: string,
  milestoneId: string,
): Promise<SubmissionFormData> {
  return apiClient<SubmissionFormData>(
    `programs/${encodeURIComponent(programId)}/milestones/${encodeURIComponent(milestoneId)}/submission-form`,
  );
}

export function createSubmission(input: {
  readonly applicationId: string;
  readonly milestoneId: string;
  readonly content: CreateSubmissionContent;
  readonly comment: string;
}): Promise<CreatedSubmission> {
  return apiClient<CreatedSubmission>('submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
