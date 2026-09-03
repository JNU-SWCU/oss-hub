import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { hasProgramDeadlinePassed } from '../../programs/program-deadline';

export type MilestoneDocumentSubmissionBlock =
  | 'MILESTONE_CLOSED'
  | 'SUBMISSION_REPLACEMENT_CLOSED'
  | 'RESUBMISSION_NOT_ALLOWED'
  | 'RESUBMISSION_ALREADY_USED';

/**
 * 마감을 지나가는 **보완 요청 한 번**이 아직 남아 있는가.
 *
 * 마감 뒤 재제출을 여는 조건은 「보완 요청 판정이 있다」가 아니라 **「보완 요청을 받고 아직
 * 응하지 않았다」**이다. 두 값을 함께 보는 이유는 판정 이력이 되돌아가지 않기 때문이다 —
 * 학생이 다시 내도 최신 판정은 계속 `CHANGES_REQUESTED`라, 판정만 보면 마감 뒤 재제출이
 * **횟수 제한 없이** 열린다. 제출 상태는 반대로 재제출 때마다 `SUBMITTED`로 돌아가므로
 * (`upsertMilestoneDocumentSubmission`), 둘을 곱해야 「돌려보냈고 아직 안 돌아왔다」가
 * 정확히 한 번만 참이 된다.
 *
 * 상태만 보지 않는 이유도 같다 — `SUBMITTED`는 「첫 제출」과 「보완 요청에 응한 재제출」을
 * 구분하지 못하고, 상태가 어긋나 온 응답 하나로 끝난 판정이 다시 열릴 수 있다.
 *
 * 이 판단은 화면의 `isMilestoneDocumentDeadlineLocked`
 * (`apps/frontend/src/features/programs/milestone-document-review.ts`)와 **같은 규칙**이다.
 * 화면은 학생 뷰 응답의 `viewerSubmission.status`가 `CHANGES_REQUESTED`인 동안만 「수정」을
 * 열어 둔다. 한쪽만 고치면 #1097이 그대로 돌아온다 — 화면은 잠갔는데 서버는 받아 주거나,
 * 그 반대가 된다.
 */
export function isChangeRequestResubmissionOpen({
  latestDecision,
  submissionStatus,
}: {
  readonly latestDecision: ReviewDecision | null;
  readonly submissionStatus: SubmissionStatus | null;
}): boolean {
  return (
    latestDecision === ReviewDecision.CHANGES_REQUESTED &&
    submissionStatus === SubmissionStatus.CHANGES_REQUESTED
  );
}

/**
 * 학생이 지금 (다시) 낼 수 있는가 — 못 내면 그 이유, 낼 수 있으면 `null`.
 *
 * 순서가 규칙이다.
 * 1. 승인·반려는 마감과 무관하게 끝난 판정이라 먼저 막는다.
 * 2. 마감 전이면 아무것도 막지 않는다 — 검토 전 파일 교체는 지금도 되는 일이다.
 * 3. 마감 뒤에는 **아직 응하지 않은 보완 요청 하나만** 지나간다(재제출은 한 번).
 * 4. 그 한 번을 이미 쓴 서류는 검토가 끝날 때까지 잠근다 — 교직원이 보고 있는 동안 내용이
 *    바뀌면 그가 보지 않은 것에 판정이 붙는다.
 * 5. 나머지(보완 요청을 거치지 않은 미제출·검토 대기)는 마감이 잠근 그대로 둔다.
 */
export function milestoneDocumentSubmissionBlock({
  dueAt,
  now,
  hasSubmission,
  latestDecision,
  submissionStatus,
}: {
  readonly dueAt: Date;
  readonly now: Date;
  readonly hasSubmission: boolean;
  readonly latestDecision: ReviewDecision | null;
  /** 현재 제출 행의 상태. 제출이 없으면 `null`. */
  readonly submissionStatus: SubmissionStatus | null;
}): MilestoneDocumentSubmissionBlock | null {
  if (
    latestDecision === ReviewDecision.APPROVED ||
    latestDecision === ReviewDecision.REJECTED
  ) {
    return 'RESUBMISSION_NOT_ALLOWED';
  }
  if (!hasProgramDeadlinePassed(dueAt, now)) return null;
  if (isChangeRequestResubmissionOpen({ latestDecision, submissionStatus })) {
    return null;
  }
  // 보완 요청은 받았는데 상태가 이미 되돌아왔다 = 그 한 번을 썼다. 제출 행 없이 판정만 있는
  // 응답은 계약에 없으므로(판정은 제출에 붙는다) `hasSubmission`을 함께 본다 — 어긋난 값
  // 하나가 「미제출인데 재제출을 다 썼다」로 읽히지 않게 한다.
  if (latestDecision === ReviewDecision.CHANGES_REQUESTED && hasSubmission) {
    return 'RESUBMISSION_ALREADY_USED';
  }
  return hasSubmission ? 'SUBMISSION_REPLACEMENT_CLOSED' : 'MILESTONE_CLOSED';
}
