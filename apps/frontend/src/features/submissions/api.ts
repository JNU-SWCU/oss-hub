import { apiClient } from '@/lib/api-client';
import type {
  CreatedResubmission,
  CreatedSubmission,
  CreateSubmissionContent,
  SubmissionChecklist,
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

/** #116 내 체크리스트 — 프로그램 전체 마일스톤과 내 제출 상태. */
export function getSubmissionChecklist(
  programId: string,
): Promise<SubmissionChecklist> {
  return apiClient<SubmissionChecklist>(
    `programs/${encodeURIComponent(programId)}/submissions/me`,
  );
}

/** #116 보완 재제출 — baseRevision으로 오래된 탭의 중복 제출을 막는다. */
export function createResubmission(input: {
  readonly submissionId: string;
  readonly baseRevision: number;
  readonly content: CreateSubmissionContent;
  readonly comment: string;
}): Promise<CreatedResubmission> {
  const { submissionId, ...body } = input;
  return apiClient<CreatedResubmission>(
    `submissions/${encodeURIComponent(submissionId)}/resubmissions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}
