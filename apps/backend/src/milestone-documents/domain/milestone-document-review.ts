/**
 * 서류 제출물 판정(승인 · 보완 요청 · 반려)의 도메인 타입.
 *
 * 판정 결과를 제출 상태로 옮기는 규칙(`reviewDecisionToSubmissionStatus`)도 여기 둔다 —
 * 응답 매핑이 아니라 업무 규칙이라 DTO가 아닌 도메인이 소유한다(ADR-003).
 */
import { ReviewDecision, SubmissionStatus } from '@prisma/client';

/** 요청 본문이 검증을 마친 뒤의 판정 입력. `comment`는 이미 trim되어 있고 빈 문자열은 null이다. */
export interface CreateMilestoneDocumentReviewInput {
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  /**
   * 검토자가 **실제로 본** 제출물의 버전 — 수합 표 칸의 `submittedAt`을 그대로 되돌려 받는다.
   *
   * 이것이 없으면 판정은 「지금 있는 행」에 붙는다. 표가 그려진 뒤 학생이 다시 내면 제출 행은
   * 같은 id를 유지한 채 내용만 바뀌므로(`upsertSubmission`은 upsert다), 잠금은 순서만 세울 뿐
   * 「이게 내가 본 그 버전인가」를 증명하지 못한다 — **교직원이 보지 못한 내용이 승인된다.**
   * `submittedAt`은 재제출마다 새로 찍히므로 그 버전을 가리키는 값이 된다.
   */
  readonly expectedSubmittedAt: Date;
  /**
   * 검토자가 표에서 본 최신 판정의 id(판정이 없었으면 null) — 칸의 `review.id`를 되돌려 받는다.
   *
   * `expectedSubmittedAt`만으로는 **다른 교직원의 더 최신 판정**을 못 잡는다(판정은 제출을
   * 건드리지 않으므로 `submittedAt`이 그대로다). 그대로 두면 나중 판정이 앞선 판정을 조용히
   * 덮는다 — 이력에는 둘 다 남지만 제출 `status`와 「최신 판정」은 늦게 커밋한 쪽이 가져간다.
   *
   * 학생 제출 경로의 `expectedLatestReviewId`와 **같은 이름·같은 뜻**이다(그쪽은 서비스가
   * 스스로 읽어 넘기고, 이쪽은 화면이 본 값을 받는다는 것만 다르다).
   */
  readonly expectedLatestReviewId: string | null;
}

/** 제출에 붙은 판정 한 건 — 수합 표의 칸과 학생 목록이 「최신 한 건」으로 읽는다. */
export interface MilestoneDocumentReviewRecord {
  /**
   * 수합 표 칸이 이 값을 그대로 실어 보내야 프런트가 판정 요청의 `expectedLatestReviewId`로
   * 되돌려 줄 수 있다. 학생 뷰는 이 값을 응답에 싣지 않는다(내부 id를 학생에게 줄 이유가 없다).
   */
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
}

/**
 * 판정 → 제출 상태. 옛 제출물 판정(`submission-reviews/submission-reviews.service.ts`의
 * `decisionStatus`)과 **같은 표**다. 그 함수는 export되지 않고 그 모듈은 우리 owned path 밖이라
 * 여기 한 벌을 둔다.
 *
 * `switch`에 `default`를 두지 않는 것이 의도다 — `ReviewDecision`에 값이 늘면 반환 타입이
 * `undefined`를 포함하게 되어 타입 검사에서 걸린다.
 */
export function reviewDecisionToSubmissionStatus(
  decision: ReviewDecision,
): SubmissionStatus {
  switch (decision) {
    case ReviewDecision.APPROVED:
      return SubmissionStatus.APPROVED;
    case ReviewDecision.CHANGES_REQUESTED:
      return SubmissionStatus.CHANGES_REQUESTED;
    case ReviewDecision.REJECTED:
      return SubmissionStatus.REJECTED;
  }
}

/**
 * 이 판정 뒤에 학생이 다시 제출할 수 있는가. 승인·반려는 끝난 판정이라 막고, 보완 요청은
 * 「다시 내라」는 뜻이므로 허용한다. 판정이 없으면(=`null`) 첫 제출이거나 아직 아무도 보지
 * 않은 상태라 그대로 허용한다.
 *
 * 옛 제출물 재제출 규칙(`submissions/submissions.service.ts`의 `assertResubmittable`)과 뜻이
 * 같다 — 그쪽은 `Submission.status`가 APPROVED/REJECTED이면 거부하고 CHANGES_REQUESTED는
 * 마감 후에도 허용한다. 여기서 상태 대신 **최신 판정**을 보는 이유: 서류 제출은 재제출이
 * 같은 행을 덮어써 `status`를 SUBMITTED로 되돌리므로, 상태만 보면 「승인된 뒤 한 번 더 낸」
 * 제출이 다시 열려 버린다. 판정 이력은 되돌아가지 않는다.
 */
export function isResubmissionAllowedAfter(
  latestDecision: ReviewDecision | null,
): boolean {
  if (latestDecision === null) return true;
  switch (latestDecision) {
    case ReviewDecision.APPROVED:
    case ReviewDecision.REJECTED:
      return false;
    case ReviewDecision.CHANGES_REQUESTED:
      return true;
  }
}
