import { apiClient, apiPath } from '@/lib/api-client';
import type { MilestoneDocumentHistoryPage } from './milestone-document-collection-api';

/**
 * 학생 뷰의 제출 상태. ⚠ `types.ts`의 `SubmissionStatus`와 **다른 집합**이다 — 그쪽에는
 * `NOT_SUBMITTED`가 있지만 이 계약은 미제출을 `null`로 말한다(제출 행이 없으면 상태도 없다).
 * 같은 이름으로 묶으면 화면이 있지도 않은 `NOT_SUBMITTED`를 분기하게 된다.
 */
export type MilestoneDocumentSubmissionStatus =
  'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

/**
 * 학생 뷰 — 이 서류에 붙은 **최신 판정 한 건**. 아직 아무도 판정하지 않았으면 `null`이다.
 *
 * ⚠ `decision`이 없는 것은 빠뜨린 것이 아니다. 같은 뜻이 옆의
 * `MilestoneDocumentViewerSubmission.status`에 이미 있다(판정 → 상태가 1:1이다).
 * 여기 있는 것은 화면이 「왜 되돌아왔는가」를 말하는 데 필요한 사유와 시각뿐이다.
 */
export interface MilestoneDocumentViewerReview {
  readonly comment: string | null;
  readonly reviewedAt: string;
}

export interface MilestoneDocumentViewerSubmission {
  /**
   * ⚠ 이름은 예전 그대로다(`isSubmitted`가 아니다). 이미 발행돼 학생 화면이 쓰는 계약이라
   * 바꾸면 화면이 조용히 「전부 미제출」로 보인다 — 수합 표 계약의 `isSubmitted`와 다른
   * 것은 의도된 비대칭이다(백엔드 `milestone-document-response.dto.ts` 주석과 같은 근거).
   */
  readonly submitted: boolean;
  readonly submittedAt: string | null;
  /** 현재 제출본 번호. 미제출이면 `null`. */
  readonly revision: number | null;
  /**
   * 최신 판정이 옮겨 놓은 제출 상태. 미제출이면 `null`.
   *
   * ⚠ `SUBMITTED`는 「아직 아무도 안 봤다」와 「보완 요청을 받고 다시 냈다」 **둘 다**를
   * 뜻한다 — 재제출이 같은 행을 덮어써 상태를 `SUBMITTED`로 되돌리기 때문이다. 그래서
   * 「지난 지적이 있었는가」는 `status`가 아니라 `review`로 봐야 한다.
   */
  readonly status: MilestoneDocumentSubmissionStatus | null;
  readonly hasCurrentFile: boolean;
  /** 아직 아무도 판정하지 않았으면 `null`. */
  readonly review: MilestoneDocumentViewerReview | null;
  /**
   * 이력 원장은 별도 cursor endpoint에서 읽는다. 목록 응답에 이력을 넣으면 여러 서류의
   * 오래된 제출본까지 한꺼번에 실려 학생 화면을 열기만 해도 무한히 커진다.
   */
  readonly history: {
    readonly hasHistory: boolean;
    readonly isComplete: boolean;
  };
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
  readonly hasTemplateFile: boolean;
  readonly templateFileName: string | null;
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

/**
 * 화면이 파일을 **고르기 전에** 읽는 업로드 규칙. 서버가 목록 응답에 함께 실어 준다.
 *
 * ⚠ 화면은 이 값의 사본을 만들지 않는다. 상한 숫자가 화면 여러 곳에 흩어져 있다가 표기가
 *   갈라진 것이 이 티켓(#1107)의 원인이다 — 서버가 거절하는 상한과 화면이 약속하는 상한은
 *   같은 값에서 나와야 한다.
 */
export interface MilestoneDocumentUploadPolicy {
  /** 실제로 거절이 갈리는 경계(바이트). */
  readonly maxBytes: number;
  /** 사람에게 보여 줄 표기. 「5 MB」 */
  readonly maxLabel: string;
  /** `<input type="file" accept>`에 그대로 넣는 값. */
  readonly accept: string;
  /** 「PDF, HWP, JPG, PNG, ZIP」 */
  readonly formatLabel: string;
}

/** `GET /milestones/:milestoneId/documents` 응답 — 항목 배열과 업로드 규칙 한 벌. */
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

export function listMilestoneDocuments(
  milestoneId: string,
): Promise<MilestoneDocumentList> {
  return apiClient<MilestoneDocumentList>(documentsPath(milestoneId));
}

/** 학생 — 본인 제출 이력의 최신 cursor 페이지. 이전 페이지는 `cursor`로 이어 읽는다. */
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

/** 교직원 서류 항목 생성/수정 요청 본문 — 두 endpoint가 같은 shape을 공유한다(전체 교체). */
export interface UpsertMilestoneDocumentInput {
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
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

/**
 * 교직원 — 서류 항목을 고친다. 일부가 아니라 전체를 보낸다(백엔드가 전체 교체다).
 *
 * ⚠ `sortOrder`는 본문 shape을 맞추려고 함께 싣지만 **서버가 무시한다** — 순서는
 * `reorderMilestoneDocuments`(`PATCH .../documents/order`)가 소유한다. 이 요청으로
 * 자리를 옮기려 들면 응답은 성공인데 순서는 그대로다.
 */
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
