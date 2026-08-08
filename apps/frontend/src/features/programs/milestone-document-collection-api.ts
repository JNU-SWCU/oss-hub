import { apiClient, apiPath } from '@/lib/api-client';
import type { SubmissionType } from './types';

/**
 * 교직원 서류 수합 표(`GET /milestones/:milestoneId/documents/collection`)의 응답 계약.
 * 원본은 백엔드 `milestone-documents/dto/milestone-document-collection-response.dto.ts`이며
 * 여기서는 그 모양을 그대로 옮기기만 한다 — 필드를 더하거나 이름을 바꾸지 않는다.
 */
export interface MilestoneDocumentCollectionMilestone {
  readonly id: string;
  readonly name: string;
  /** ISO 8601. 화면은 `program-detail-format.ts`의 서울 시각 포매터로만 표시한다. */
  readonly dueAt: string;
}

/** 표의 열 — 이 마일스톤이 요구하는 서류 항목. `sortOrder` 오름차순으로 온다. */
export interface MilestoneDocumentCollectionDocument {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly submissionType: SubmissionType;
}

/** `submissionType === 'FILE'`이고 만료되지 않은 첨부가 있을 때만 채워진다. */
export interface MilestoneDocumentCollectionFile {
  readonly name: string;
  readonly sizeBytes: number;
}

/** 표의 칸 — 미제출도 칸이 비지 않고 `submitted: false`로 채워져 온다. */
export interface MilestoneDocumentCollectionCell {
  readonly documentId: string;
  readonly submitted: boolean;
  readonly submittedAt: string | null;
  readonly file: MilestoneDocumentCollectionFile | null;
}

/** 표의 행 — 승인된 신청(= 팀) 하나. */
export interface MilestoneDocumentCollectionRow {
  readonly applicationId: string;
  readonly teamName: string;
  /** 프로필을 아직 채우지 않은 신청자는 `null`이다 — 대체 표기는 화면이 정한다. */
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
  readonly cells: readonly MilestoneDocumentCollectionCell[];
}

export interface MilestoneDocumentCollection {
  readonly milestone: MilestoneDocumentCollectionMilestone;
  readonly documents: readonly MilestoneDocumentCollectionDocument[];
  readonly rows: readonly MilestoneDocumentCollectionRow[];
}

function documentsPath(milestoneId: string): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents`;
}

/** 교직원 전용 — 마일스톤 하나의 팀×서류 수합 표를 통째로 받는다(페이지네이션 없음). */
export function getMilestoneDocumentCollection(
  milestoneId: string,
): Promise<MilestoneDocumentCollection> {
  return apiClient<MilestoneDocumentCollection>(
    `${documentsPath(milestoneId)}/collection`,
  );
}

/**
 * `<a href>`로 바로 거는 제출 파일 다운로드 경로.
 * `apiPath`가 `/api/v1`의 유일한 소유자다(`milestone-document-api.ts`의
 * `milestoneDocumentTemplateHref`와 같은 패턴) — 여기서 경로를 손으로 잇지 않는다.
 */
export function milestoneDocumentSubmissionFileHref(
  milestoneId: string,
  documentId: string,
  applicationId: string,
): string {
  return apiPath(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/applications/${encodeURIComponent(applicationId)}/file`,
  );
}
