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

/** 교직원 서류 항목 생성/수정 요청 본문 — 두 endpoint가 같은 shape을 공유한다(전체 교체). */
export interface UpsertMilestoneDocumentInput {
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly submissionType: SubmissionType;
}

function documentPath(milestoneId: string, documentId: string): string {
  return `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}`;
}

function jsonRequest(method: 'POST' | 'PATCH', input: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  };
}

/** 교직원 — 서류 항목을 새로 만든다. */
export function createMilestoneDocument(
  milestoneId: string,
  input: UpsertMilestoneDocumentInput,
): Promise<MilestoneDocument> {
  return apiClient<MilestoneDocument>(
    documentsPath(milestoneId),
    jsonRequest('POST', input),
  );
}

/** 교직원 — 서류 항목을 고친다. 일부가 아니라 전체를 보낸다(백엔드가 전체 교체다). */
export function updateMilestoneDocument(
  milestoneId: string,
  documentId: string,
  input: UpsertMilestoneDocumentInput,
): Promise<MilestoneDocument> {
  return apiClient<MilestoneDocument>(
    documentPath(milestoneId, documentId),
    jsonRequest('PATCH', input),
  );
}

/**
 * 교직원 — 이 마일스톤의 서류 **전체**를 원하는 순서로 다시 매긴다.
 *
 * 부분이 아니라 전체를 보내는 것이 이 endpoint의 핵심이다. 두 항목을 각각 PATCH하다
 * 한쪽만 성공하면 sortOrder가 같은 두 항목이 남고, 그 뒤로는 「위로」가 조용히 아무
 * 일도 하지 않는다(같은 값끼리 맞바꿔도 순서가 그대로다). 누락·중복·타 마일스톤 id가
 * 섞이면 서버가 400(MSD_019)으로 거절한다.
 *
 * 응답은 sortOrder를 1부터 다시 매긴 목록 전체다 — 호출부는 낙관적 갱신 대신 이 값을
 * 그대로 화면 상태로 삼는다.
 */
export function reorderMilestoneDocuments(
  milestoneId: string,
  documentIds: readonly string[],
): Promise<readonly MilestoneDocument[]> {
  return apiClient<readonly MilestoneDocument[]>(
    `${documentsPath(milestoneId)}/order`,
    jsonRequest('PATCH', { documentIds }),
  );
}

/** 교직원 — 서류 항목을 지운다. 204라 본문이 없다. */
export async function deleteMilestoneDocument(
  milestoneId: string,
  documentId: string,
): Promise<void> {
  await apiClient<null>(documentPath(milestoneId, documentId), {
    method: 'DELETE',
  });
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
