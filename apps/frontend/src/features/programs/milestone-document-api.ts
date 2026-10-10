import { apiClient, apiPath } from '@/lib/api-client';
import type { MilestoneDocumentHistoryPage } from './milestone-document-collection-api';

export type MilestoneDocumentSubmissionStatus =
  'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

interface MilestoneDocumentViewerReview {
  readonly comment: string | null;
  readonly reviewedAt: string;

  readonly resubmissionDueAt: string | null;
}

export interface MilestoneDocumentViewerSubmission {
  readonly submitted: boolean;
  readonly submittedAt: string | null;

  readonly revision: number | null;

  readonly status: MilestoneDocumentSubmissionStatus | null;
  readonly hasCurrentFile: boolean;

  readonly currentFileName: string | null;

  readonly review: MilestoneDocumentViewerReview | null;

  readonly history: {
    readonly hasHistory: boolean;
    readonly isComplete: boolean;
  };
}

interface MilestoneDocumentTeamSubmissionCount {
  readonly submitted: number;
  readonly total: number;
}

export interface MilestoneDocument {
  readonly id: string;
  readonly milestoneId: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly hasTemplateFile: boolean;
  readonly templateFileName: string | null;

  readonly viewerSubmission?: MilestoneDocumentViewerSubmission;

  readonly teamSubmissionCount?: MilestoneDocumentTeamSubmissionCount;
}

export interface UploadedMilestoneDocumentFile {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}

export interface MilestoneDocumentUploadPolicy {
  readonly maxBytes: number;

  readonly maxLabel: string;

  readonly accept: string;

  readonly formatLabel: string;
}

export type PreparedMilestoneDocumentUpload = {
  readonly localId: string;
  readonly uploadId: string;
};

export interface MilestoneDocumentList {
  readonly documents: readonly MilestoneDocument[];
  readonly fileUpload: MilestoneDocumentUploadPolicy;
}

export interface MilestoneDocumentSubmission {
  readonly id: string;
  readonly status: string;
  readonly submittedAt: string;
}

export type MilestoneDocumentSubmissionContent = {
  readonly text: string | null;
  readonly fileId: string | null;
};

function documentsPath(milestoneId: string): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents`;
}

function documentPath(milestoneId: string, documentId: string): string {
  return `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}`;
}

export function listMilestoneDocuments(
  milestoneId: string,
): Promise<MilestoneDocumentList> {
  return apiClient<MilestoneDocumentList>(documentsPath(milestoneId));
}

export function getMilestoneDocumentParticipantHistory(
  milestoneId: string,
  documentId: string,
  cursor: string | null = null,
): Promise<MilestoneDocumentHistoryPage> {
  const params = new URLSearchParams();
  params.set('limit', '20');
  if (cursor !== null) params.set('cursor', cursor);
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
      headers: { 'Content-Type': 'application/json' },
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
