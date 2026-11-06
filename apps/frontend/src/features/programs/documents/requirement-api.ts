import { requireRequirementList } from './requirement-list-response';
import { apiClient, apiPath } from '@/lib/api-client';
import type { RequirementHistoryPage } from './requirement-collection-dto';
import type {
  UploadedRequirementFile,
  RequirementList,
  Submission,
  SubmissionContent,
} from './requirement-dto';

function documentsPath(milestoneId: string): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents`;
}

function documentPath(milestoneId: string, documentId: string): string {
  return `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}`;
}

export async function listRequirements(
  milestoneId: string,
  scope?: 'all',
): Promise<RequirementList> {
  return requireRequirementList(
    await apiClient<unknown>(
      `${documentsPath(milestoneId)}${scope === 'all' ? '?scope=all' : ''}`,
    ),
  );
}

export async function updateRequirementGrace(
  milestoneId: string,
  documentId: string,
  graceDueAt: string | null,
): Promise<void> {
  await apiClient<null>(`${documentPath(milestoneId, documentId)}/grace`, {
    method: 'PATCH',
    body: JSON.stringify({ graceDueAt }),
  });
}

export function getRequirementParticipantHistory(
  milestoneId: string,
  documentId: string,
  cursor: string | null = null,
): Promise<RequirementHistoryPage> {
  const params = new URLSearchParams();
  params.set('limit', '20');
  if (cursor?.trim()) params.set('cursor', cursor);
  return apiClient<RequirementHistoryPage>(
    `${documentPath(milestoneId, documentId)}/history?${params.toString()}`,
  );
}

export function uploadRequirementFile(
  milestoneId: string,
  documentId: string,
  file: File,
): Promise<UploadedRequirementFile> {
  const body = new FormData();
  body.append('milestoneId', milestoneId);
  body.append('documentId', documentId);
  body.append('file', file);
  return apiClient<UploadedRequirementFile>('milestone-document-files', {
    method: 'POST',
    body,
  });
}

export async function checkRequirementFile(file: File): Promise<void> {
  const body = new FormData();
  body.append('file', file);
  await apiClient<null>('milestone-document-files/checks', {
    method: 'POST',
    body,
  });
}

export function submitRequirement(
  milestoneId: string,
  documentId: string,
  content: SubmissionContent,
  options: { readonly expectedRevision: number; readonly comment?: string },
): Promise<Submission> {
  return apiClient<Submission>(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/submissions`,
    {
      method: 'POST',
      body: JSON.stringify({ content, ...options }),
    },
  );
}

export function requirementTemplateHref(
  milestoneId: string,
  documentId: string,
): string {
  return apiPath(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/template`,
  );
}
