import { apiClient } from '@/lib/api-client';
import { buildMatrixSearchParams, type MatrixQueryInput } from './matrix';
import type {
  CreatedSubmission,
  CreateSubmissionContent,
  SubmissionFormData,
  SubmissionMatrixPage,
} from './types';

export function getSubmissionForm(
  programId: string,
  milestoneId: string,
): Promise<SubmissionFormData> {
  return apiClient<SubmissionFormData>(
    `programs/${encodeURIComponent(programId)}/milestones/${encodeURIComponent(milestoneId)}/submission-form`,
  );
}

/** #124 제출 현황 매트릭스 조회 — 접근: APPROVED STAFF·ADMIN. */
export function getSubmissionMatrix(
  programId: string,
  query: MatrixQueryInput,
): Promise<SubmissionMatrixPage> {
  const params = buildMatrixSearchParams(query);
  return apiClient<SubmissionMatrixPage>(
    `programs/${encodeURIComponent(programId)}/submissions/matrix?${params.toString()}`,
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
