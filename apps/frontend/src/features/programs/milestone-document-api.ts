import { apiClient, apiPath } from '@/lib/api-client';
import type { SubmissionType } from './types';

export interface MilestoneDocumentViewerSubmission {
  readonly submitted: boolean;
  readonly submittedAt: string | null;
}

export interface MilestoneDocumentTeamSubmissionCount {
  readonly submitted: number;
  readonly total: number;
}

/** `GET /milestones/:milestoneId/documents` 응답 항목 하나. */
export interface MilestoneDocument {
  readonly id: string;
  readonly milestoneId: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly submissionType: SubmissionType;
  readonly hasTemplateFile: boolean;
  /** 학생 뷰에서만 채워진다. */
  readonly viewerSubmission?: MilestoneDocumentViewerSubmission;
  /** 교직원 뷰에서만 채워진다. */
  readonly teamSubmissionCount?: MilestoneDocumentTeamSubmissionCount;
}

export interface UploadedMilestoneDocumentFile {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}

export interface UploadedMilestoneDocumentTemplate {
  readonly documentId: string;
  readonly hasTemplateFile: true;
  readonly fileName: string;
  readonly uploadedAt: string;
}

export interface MilestoneDocumentSubmission {
  readonly id: string;
  readonly status: string;
  readonly submittedAt: string;
}

export type MilestoneDocumentSubmissionContent =
  | { readonly type: 'FILE'; readonly fileId: string }
  | { readonly type: 'TEXT'; readonly text: string }
  | { readonly type: 'REPOSITORY_RELEASE'; readonly releaseUrl: string };

function documentsPath(milestoneId: string): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents`;
}

export function listMilestoneDocuments(
  milestoneId: string,
): Promise<readonly MilestoneDocument[]> {
  return apiClient<readonly MilestoneDocument[]>(documentsPath(milestoneId));
}

/** 학생 — 제출용 파일을 먼저 올려 fileId를 받는다(제출 자체는 submitMilestoneDocument가 한다). */
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

/** 학생 — 서류 제출/재제출. */
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

/** 교직원 — 서류 항목의 양식 파일을 올리거나 교체한다. */
export function uploadMilestoneDocumentTemplate(
  milestoneId: string,
  documentId: string,
  file: File,
): Promise<UploadedMilestoneDocumentTemplate> {
  const body = new FormData();
  body.append('file', file);
  return apiClient<UploadedMilestoneDocumentTemplate>(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/template`,
    { method: 'POST', body },
  );
}

/** `<a href>` 등에 직접 쓰는 양식 다운로드 경로 — apiPath가 baseURL의 유일한 소유자. */
export function milestoneDocumentTemplateHref(
  milestoneId: string,
  documentId: string,
): string {
  return apiPath(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/template`,
  );
}
