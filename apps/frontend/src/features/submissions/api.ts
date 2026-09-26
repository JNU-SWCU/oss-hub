import {
  apiClient,
  apiFileClient,
  type ApiFileDownload,
} from '@/lib/api-client';
import { buildMatrixSearchParams, type MatrixQueryInput } from './matrix';
import { requireSubmissionUploadLimit } from '@/lib/submission-upload-policy';
import type {
  CreatedResubmission,
  CreatedSubmission,
  CreateSubmissionContent,
  ResubmissionContent,
  SubmissionChecklist,
  SubmissionFormData,
  SubmissionMatrixPage,
  MilestoneDocumentCurrentFileItem,
  UploadedSubmissionFile,
} from './types';

function milestoneDocumentsPath(milestoneId: string): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents`;
}

/**
 * ⚠ 이 endpoint는 항목 배열이 아니라 **봉투**를 돌려준다 — `{ documents, fileUpload }`
 * (백엔드 `MilestoneDocumentListResponseDto`, #1107). 화면이 쓰는 것은 항목뿐이라
 * 여기서 벗겨 낸다.
 *
 * 봉투가 아닌 응답은 빈 목록으로 삼키지 않고 던진다. 조용히 빈 칸을 그리면
 * 계약이 다시 갈리는 날 화면은 「난 파일이 없다」고 말하고 아무도 모른다
 * (같은 이유로 `requireSubmissionUploadLimit`도 던진다).
 */
export async function listMilestoneDocumentCurrentFiles(
  milestoneId: string,
): Promise<readonly MilestoneDocumentCurrentFileItem[]> {
  const response = await apiClient<{
    readonly documents: readonly MilestoneDocumentCurrentFileItem[];
  }>(milestoneDocumentsPath(milestoneId));
  if (!Array.isArray(response?.documents))
    throw new TypeError('Invalid milestone document list response');
  return response.documents;
}

export function downloadMilestoneDocumentCurrentFile(
  milestoneId: string,
  documentId: string,
): Promise<ApiFileDownload> {
  return apiFileClient(
    `${milestoneDocumentsPath(milestoneId)}/${encodeURIComponent(documentId)}/submissions/current/file`,
  );
}

export async function getSubmissionForm(
  programId: string,
  milestoneId: string,
): Promise<SubmissionFormData> {
  const response = await apiClient<SubmissionFormData>(
    `programs/${encodeURIComponent(programId)}/milestones/${encodeURIComponent(milestoneId)}/submission-form`,
  );
  return {
    ...response,
    fileUpload: requireSubmissionUploadLimit(response.fileUpload),
  };
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

export function uploadSubmissionFile(
  applicationId: string,
  milestoneId: string,
  file: File,
  context?: {
    readonly submissionId: string;
    readonly baseRevision: number;
  },
): Promise<UploadedSubmissionFile> {
  const body = new FormData();
  body.append('applicationId', applicationId);
  body.append('milestoneId', milestoneId);
  if (context) {
    body.append('submissionId', context.submissionId);
    body.append('baseRevision', String(context.baseRevision));
  }
  body.append('file', file);

  return apiClient<UploadedSubmissionFile>('submission-files', {
    method: 'POST',
    body,
  });
}

/**
 * #1108 고른 파일에 제출과 같은 판정만 받는다 — 서버는 저장하지 않는다.
 * 통과면 본문 없이 끝나고, 거절이면 제출 때와 같은 코드의 `ApiError`를 던진다.
 */
export async function checkSubmissionFile(file: File): Promise<void> {
  const body = new FormData();
  body.append('file', file);
  await apiClient<null>('submission-files/checks', { method: 'POST', body });
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
export async function getSubmissionChecklist(
  programId: string,
): Promise<SubmissionChecklist> {
  const response = await apiClient<SubmissionChecklist>(
    `programs/${encodeURIComponent(programId)}/submissions/me`,
  );
  return {
    ...response,
    fileUpload: requireSubmissionUploadLimit(response.fileUpload),
  };
}

/** #116 보완 재제출 — baseRevision으로 오래된 탭의 중복 제출을 막는다. */
export function createResubmission(input: {
  readonly submissionId: string;
  readonly baseRevision: number;
  readonly content: ResubmissionContent;
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
