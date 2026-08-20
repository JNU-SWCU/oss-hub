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
  /**
   * 판정을 붙일 제출물의 번호 — **내가 본 그 칸의 `revision`을 그대로** 되돌려 보낸다.
   *
   * ⚠ 선택이 아니다. 빼먹으면 400이다. 「보내면 검사하고 안 보내면 넘어간다」로 두면
   * 검사를 우회하는 길이 되어, 이 두 필드가 막으려던 「보지 못한 내용을 승인한다」가
   * 요청 하나로 되살아난다.
   */
  readonly expectedRevision: number;
  /**
   * 내가 본 칸의 `review.id`. 아직 판정이 없던 칸은 **`null`을 명시해서** 보낸다 —
   * 키를 빼면 400이다(백엔드가 `@IsOptional`이 아니라 `@ValidateIf`로 받는다:
   * `null`(판정이 없었다)만 허용하고 누락은 막는다).
   */
  readonly expectedLatestReviewId: string | null;
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
 * - `MSD_024` 409 — 그 사이 다른 검토 결과가 등록됐다. 손에 든 「지난 검토」가 이미 낡았다.
 *   **학생 제출 경로**에서 나는 갈래다.
 * - `MSD_025` 409 — 내가 **본 그 제출물**이 아닌 것에 판정이 붙으려 했다. 표를 그린 뒤
 *   학생이 다시 냈거나 다른 교직원이 먼저 판정한 것이다. 024와 갈라 둔 이유는 **말 거는
 *   상대와 바뀐 것이 다르기** 때문이다 — 여기서 막히는 사람은 교직원이고, 바뀐 것은
 *   판정만이 아니라 제출물 자체일 수 있다. 두 코드에 같은 문구를 쓰면 「무엇이 바뀌었는지」가
 *   사라진다.
 */
export const MILESTONE_DOCUMENT_REVIEW_ERROR_CODES = {
  COMMENT_REQUIRED: 'MSD_021',
  SUBMISSION_NOT_FOUND: 'MSD_022',
  REVIEW_CHANGED: 'MSD_024',
  REVIEW_TARGET_CHANGED: 'MSD_025',
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
 *
 * ⚠ `input`의 기대 버전 두 값은 **패널을 열 때 화면에 있던 칸**에서 떠 온 것이어야 한다.
 * 보내는 순간에 표를 다시 읽어 채우면 언제나 최신값이 실려 검사가 통과하고, 그러면 이
 * 검사가 막으려던 「그 사이 바뀐 제출물에 판정이 붙는다」가 그대로 일어난다.
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
