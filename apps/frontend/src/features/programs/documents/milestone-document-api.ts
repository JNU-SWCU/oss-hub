import { requireMilestoneDocumentList } from './milestone-document-list-response';
import { apiClient, apiPath } from '@/lib/api-client';
import type { MilestoneDocumentHistoryPage } from './milestone-document-collection-dto';
import type {
  UploadedMilestoneDocumentFile,
  MilestoneDocumentList,
  MilestoneDocumentSubmission,
  MilestoneDocumentSubmissionContent,
} from './milestone-document-dto';

function documentsPath(milestoneId: string): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents`;
}

function documentPath(milestoneId: string, documentId: string): string {
  return `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}`;
}

export async function listMilestoneDocuments(
  milestoneId: string,
): Promise<MilestoneDocumentList> {
  return requireMilestoneDocumentList(
    await apiClient<unknown>(documentsPath(milestoneId)),
  );
}

export async function updateMilestoneDocumentGrace(
  milestoneId: string,
  documentId: string,
  graceDueAt: string | null,
): Promise<void> {
  await apiClient<null>(`${documentPath(milestoneId, documentId)}/grace`, {
    method: 'PATCH',
    body: JSON.stringify({ graceDueAt }),
  });
}

export function getMilestoneDocumentParticipantHistory(
  milestoneId: string,
  documentId: string,
  cursor: string | null = null,
): Promise<MilestoneDocumentHistoryPage> {
  const params = new URLSearchParams();
  params.set('limit', '20');
  if (cursor?.trim()) params.set('cursor', cursor);
  return apiClient<MilestoneDocumentHistoryPage>(
    `${documentPath(milestoneId, documentId)}/history?${params.toString()}`,
  );
}

export function uploadMilestoneDocumentFile(
  milestoneId: string,
  documentId: string,
  file: File,
): Promise<UploadedMilestoneDocumentFile> {
  const body = new FormData();
  body.append('milestoneId', milestoneId);
  body.append('documentId', documentId);
  body.append('file', file);
  return apiClient<UploadedMilestoneDocumentFile>('milestone-document-files', {
    method: 'POST',
    body,
  });
}

export async function checkMilestoneDocumentFile(file: File): Promise<void> {
  const body = new FormData();
  body.append('file', file);
  await apiClient<null>('milestone-document-files/checks', {
    method: 'POST',
    body,
  });
}

export function submitMilestoneDocument(
  milestoneId: string,
  documentId: string,
  content: MilestoneDocumentSubmissionContent,
): Promise<MilestoneDocumentSubmission> {
  return apiClient<MilestoneDocumentSubmission>(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/submissions`,
    {
      method: 'POST',
      body: JSON.stringify({ content }),
    },
  );
}

export function milestoneDocumentTemplateHref(
  milestoneId: string,
  documentId: string,
): string {
  return apiPath(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/template`,
  );
}
