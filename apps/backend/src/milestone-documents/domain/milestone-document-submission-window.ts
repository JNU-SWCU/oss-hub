import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { hasProgramDeadlinePassed } from '../../programs/program-deadline';

export type MilestoneDocumentSubmissionBlock =
  | 'MILESTONE_CLOSED'
  | 'SUBMISSION_REPLACEMENT_CLOSED'
  | 'RESUBMISSION_NOT_ALLOWED'
  | 'RESUBMISSION_ALREADY_USED'
  | 'RESUBMISSION_DUE_AT_PASSED';

/**
 * 교직원이 정한 재제출 기한이 지났는가 — 기한이 없는 보완 요청은 **지나지 않은 것으로 본다**.
 *
 * `null`은 「기한 없음」이 아니라 **「이 컬럼이 생기기 전에 저장된 보완 요청」**이다. 새 보완
 * 요청은 요청 DTO가 기한을 필수로 받으므로 여기에 `null`로 도착할 수 없다
 * (`dto/create-milestone-document-review-request.dto.ts`).
 *
 * ⚠ 그 `null`을 「기한이 지났다」로 읽으면, 배포되는 순간 **이미 「고쳐서 다시 내세요」를 받고
 * 아직 응하지 않은 학생이 낼 길을 잃는다** — 교직원이 새로 판정하기 전에는 되돌릴 방법도 없다.
 * 그래서 여기서는 앞 규칙(#1097의 「재제출은 한 번」)을 그대로 둔다. **동규가 이 방향으로
 * 결정했다(2026-09-05)** — 옛 보완 요청은 종전대로 한 번 낼 수 있고, 새 보완 요청부터
 * 기한이 붙는다. 실사용자 테스트 기간에 「어제까지 되던 것이 안 되는」 변화를 만들지 않기
 * 위해서다. 배포 시점 운영 데이터에서 실제로 걸리는 학생은 1명이었다(보완 요청 4건 중
 * 마감 지난 미응답 1건).
 *
 * 기한 없는 보완 요청은 새로 생기지 않으므로 시간이 지나며 자연히 사라진다.
 */
export function hasMilestoneDocumentResubmissionDueAtPassed(
  resubmissionDueAt: Date | null,
  now: Date,
): boolean {
  if (resubmissionDueAt === null) return false;
  return hasProgramDeadlinePassed(resubmissionDueAt, now);
}

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
 * 마감을 지나가는 예외가 **지금** 열려 있는가 — 「아직 응하지 않은 보완 요청」이면서 「교직원이
 * 정한 기한도 아직 남았다」.
 *
 * 잠금 아래의 마감 재확인(`upsertMilestoneDocumentSubmission`의 `allowAfterDeadline`)과
 * `milestoneDocumentSubmissionBlock`이 **둘 다 이 함수를** 지난다. 두 자리가 조건을 각자 적으면
 * 갈라진다 — 앞에서 막은 것이 잠금 아래에서 통과하거나(기한 지난 재제출이 저장된다) 그 반대가
 * 된다. 앞 판단은 트랜잭션 밖이라 그 사이 교직원이 새로 판정할 수 있고, 그래서 재확인이 있다.
 */
export function isPostDeadlineResubmissionOpen({
  latestDecision,
  submissionStatus,
  resubmissionDueAt,
  now,
}: {
  readonly latestDecision: ReviewDecision | null;
  readonly submissionStatus: SubmissionStatus | null;
  readonly resubmissionDueAt: Date | null;
  readonly now: Date;
}): boolean {
  return (
    isChangeRequestResubmissionOpen({ latestDecision, submissionStatus }) &&
    !hasMilestoneDocumentResubmissionDueAtPassed(resubmissionDueAt, now)
  );
}

/**
 * 학생이 지금 (다시) 낼 수 있는가 — 못 내면 그 이유, 낼 수 있으면 `null`.
 *
 * 순서가 규칙이다.
 * 1. 승인·반려는 마감과 무관하게 끝난 판정이라 먼저 막는다.
 * 2. 마감 전이면 아무것도 막지 않는다 — 검토 전 파일 교체는 지금도 되는 일이다.
 * 3. 마감 뒤에는 **아직 응하지 않은 보완 요청 하나만** 지나간다(재제출은 한 번). 그 한 번도
 *    교직원이 정한 재제출 기한 안에서만 열린다.
 * 4. 그 한 번을 이미 쓴 서류는 검토가 끝날 때까지 잠근다 — 교직원이 보고 있는 동안 내용이
 *    바뀌면 그가 보지 않은 것에 판정이 붙는다.
 * 5. 나머지(보완 요청을 거치지 않은 미제출·검토 대기)는 마감이 잠근 그대로 둔다.
 *
 * ⚠ 재제출 기한은 **마감이 닫은 것을 다시 여는 창의 크기**만 정한다. 마감 전(2번)에는 보지
 * 않는다 — 마감 전 교체는 보완 요청과 무관하게 열려 있는 기능이라, 여기서 기한으로 함께
 * 닫으면 지금 되는 일 하나가 사라진다. 그래서 기한을 마감보다 이르게 잡으면 그 보완 요청은
 * 마감이 지나는 순간 이미 닫혀 있다.
 */
export function milestoneDocumentSubmissionBlock({
  dueAt,
  now,
  hasSubmission,
  latestDecision,
  submissionStatus,
  resubmissionDueAt,
}: {
  readonly dueAt: Date;
  readonly now: Date;
  readonly hasSubmission: boolean;
  readonly latestDecision: ReviewDecision | null;
  /** 현재 제출 행의 상태. 제출이 없으면 `null`. */
  readonly submissionStatus: SubmissionStatus | null;
  /**
   * 최신 판정에 붙은 재제출 기한. 판정이 없거나 승인·반려거나, 이 컬럼이 생기기 전에 저장된
   * 보완 요청이면 `null`이다 — 그 뜻은 `hasMilestoneDocumentResubmissionDueAtPassed`가 정한다.
   *
   * 선택 인자가 아닌 것이 의도다. 빠뜨린 호출자는 조용히 「기한 없음」으로 통과하는 대신
   * 타입 검사에서 걸린다 — 관문이 둘이라(제출·파일 업로드) 한쪽만 기한을 보면 학생은 파일을
   * 올린 뒤 제출에서 막히거나 그 반대가 된다.
   */
  readonly resubmissionDueAt: Date | null;
}): MilestoneDocumentSubmissionBlock | null {
  if (
    latestDecision === ReviewDecision.APPROVED ||
    latestDecision === ReviewDecision.REJECTED
  ) {
    return 'RESUBMISSION_NOT_ALLOWED';
  }
  if (!hasProgramDeadlinePassed(dueAt, now)) return null;
  if (
    isPostDeadlineResubmissionOpen({
      latestDecision,
      submissionStatus,
      resubmissionDueAt,
      now,
    })
  ) {
    return null;
  }
  // 아직 응하지 않은 보완 요청인데 위에서 안 열렸다 = 교직원이 정한 기한이 지났다. 마감이
  // 아니라 **그 기한**이 막는 것이라 코드도 따로 있어야 한다: MSD_031은 「이미 다시 냈다」고
  // 말하는데, 여기서 막히는 학생은 아직 한 번도 응하지 않은 사람이다.
  if (isChangeRequestResubmissionOpen({ latestDecision, submissionStatus })) {
    return 'RESUBMISSION_DUE_AT_PASSED';
  }
  // 보완 요청은 받았는데 상태가 이미 되돌아왔다 = 그 한 번을 썼다. 제출 행 없이 판정만 있는
  // 응답은 계약에 없으므로(판정은 제출에 붙는다) `hasSubmission`을 함께 본다 — 어긋난 값
  // 하나가 「미제출인데 재제출을 다 썼다」로 읽히지 않게 한다.
  if (latestDecision === ReviewDecision.CHANGES_REQUESTED && hasSubmission) {
    return 'RESUBMISSION_ALREADY_USED';
  }
  return hasSubmission ? 'SUBMISSION_REPLACEMENT_CLOSED' : 'MILESTONE_CLOSED';
}
