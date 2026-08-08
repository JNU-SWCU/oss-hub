import { apiClient } from '@/lib/api-client';

/**
 * 서류 제출물 판정(`POST .../applications/:applicationId/reviews`)의 요청·응답 계약.
 * 원본은 백엔드 `milestone-documents/dto/create-milestone-document-review-request.dto.ts`와
 * `milestone-documents/dto/milestone-document-review-response.dto.ts`이며 여기서는 그 모양을
 * 그대로 옮기기만 한다 — 필드를 더하거나 이름을 바꾸지 않는다.
 */

export const MILESTONE_DOCUMENT_REVIEW_DECISIONS = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
] as const;

export type MilestoneDocumentReviewDecision =
  (typeof MILESTONE_DOCUMENT_REVIEW_DECISIONS)[number];

/** 백엔드 `@MaxLength(2_000)`과 같은 값 — 입력 칸의 `maxLength`도 이 상수를 쓴다. */
export const MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH = 2_000;

export interface MilestoneDocumentReviewInput {
  readonly decision: MilestoneDocumentReviewDecision;
  /**
   * 승인은 생략할 수 있고 보완 요청·반려는 있어야 한다(없으면 422 MSD_021).
   * 공백만 보내면 서버가 `trim()` 후 빈 문자열을 `null`로 접어 같이 거절하므로,
   * 화면은 애초에 공백만 남은 사유를 보내지 않는다.
   */
  readonly comment?: string;
}

/** 201 응답 — 방금 만든 판정 한 건. */
export interface CreatedMilestoneDocumentReview {
  readonly id: string;
  readonly decision: MilestoneDocumentReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;
  /** 판정자 표시 이름. 판정은 쌓이므로 「누가 언제」를 남길 수 있게 서버가 싣는다. */
  readonly reviewerNickname: string;
}

/**
 * 판정 관련 오류 코드. 화면이 갈래를 나눠야 하는 것만 이름을 준다.
 *
 * - `MSD_021` 422 — 보완 요청·반려인데 사유가 없다. 화면이 먼저 막으므로 여기까지 오면
 *   검증이 새어 나간 것이다.
 * - `MSD_022` 404 — 그 팀의 제출이 없다. 표를 열어 둔 사이 제출이 사라졌다는 뜻이다.
 * - `MSD_024` 409 — 그 사이 다른 판정이 등록됐다. 손에 든 「지난 판정」이 이미 낡았다.
 */
export const MILESTONE_DOCUMENT_REVIEW_ERROR_CODES = {
  COMMENT_REQUIRED: 'MSD_021',
  SUBMISSION_NOT_FOUND: 'MSD_022',
  REVIEW_CHANGED: 'MSD_024',
} as const;

function reviewsPath(
  milestoneId: string,
  documentId: string,
  applicationId: string,
): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents/${encodeURIComponent(documentId)}/applications/${encodeURIComponent(applicationId)}/reviews`;
}

/**
 * 교직원 — 한 팀이 낸 서류 제출물을 판정한다.
 *
 * ⚠ 이 호출은 **덮어쓰지 않고 쌓는다**(그래서 POST다). 같은 제출을 두 번 판정하면 판정이
 * 두 건 남고, 응답·수합 표는 그중 최신 한 건만 보여 준다. 「고치기」로 읽고 PATCH 같은
 * 것을 찾지 마라 — 지난 지적이 남는 것이 이 기능의 요구다.
 */
export function createMilestoneDocumentReview(
  milestoneId: string,
  documentId: string,
  applicationId: string,
  input: MilestoneDocumentReviewInput,
): Promise<CreatedMilestoneDocumentReview> {
  return apiClient<CreatedMilestoneDocumentReview>(
    reviewsPath(milestoneId, documentId, applicationId),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}
