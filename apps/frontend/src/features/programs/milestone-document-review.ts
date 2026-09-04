import type {
  MilestoneDocumentSubmissionStatus,
  MilestoneDocumentViewerSubmission,
} from './milestone-document-api';
import type {
  MilestoneDocumentCollectionCell,
  MilestoneDocumentCollectionHistory,
} from './milestone-document-collection-api';
import {
  MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH,
  type MilestoneDocumentReviewDecision,
} from './milestone-document-review-api';
import { isPastDue } from './program-detail-format';

/**
 * 서류 제출물 판정의 **화면 판단** 전담부 — 판정 라벨, 상태 → 배지 매핑, 사유 필수 검증,
 * 학생의 재제출 가능 여부. 교직원 수합 표(`milestone-document-collection-view.tsx`)와
 * 학생 목록(`milestone-document-list.tsx`)이 같은 표를 보게 하려고 한자리에 둔다.
 *
 * ⚠ 여기 있는 것은 **표시와 입력 검증**이다. 무엇을 저장할지는 서버가 정한다 — 이 파일의
 * 검증을 통과했다고 저장이 보장되지 않고(422·404·409가 그대로 온다), 반대로 여기서 막는
 * 것은 서버도 막는 것뿐이다. 서버가 안 막는 것을 여기서 막기 시작하면 화면만 더 엄격해져
 * 교직원이 이유를 알 수 없는 벽을 만난다.
 */

/**
 * 한 칸(교직원)·한 줄(학생)이 지금 어떤 상태인가. 다섯 갈래는 교직원 표와 학생 목록이
 * 공유한다 — 같은 제출을 두 화면이 다른 말로 부르면 「보완 요청」을 받은 학생과 그것을
 * 「제출됨」으로 보는 교직원이 서로 다른 사실을 말하게 된다.
 */
export type MilestoneDocumentReviewDisplay =
  | 'NOT_SUBMITTED'
  | 'PENDING'
  | 'REPENDING'
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'REJECTED';

export const MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS = {
  NOT_SUBMITTED: '미제출',
  PENDING: '검토 대기',
  REPENDING: '재검토 대기',
  APPROVED: '승인',
  CHANGES_REQUESTED: '보완 요청',
  REJECTED: '반려',
} as const satisfies Readonly<Record<MilestoneDocumentReviewDisplay, string>>;

/**
 * 배지 색 — 전부 기존 `StatusBadge` 변형이다. 새 색을 만들지 않는다.
 *
 * 다섯 갈래에 다섯 변형이 1:1로 붙는다: 미제출은 회색(`closed`), 검토 대기는 진행 중을
 * 뜻하는 중립색(`recruiting`), 나머지 셋은 판정 색 그대로다. 「검토 대기」와 「보완 요청」을
 * 같은 색으로 묶지 않는 것이 요점이다 — 독촉 대상을 눈으로 고르는 화면에서 그 둘이 같은
 * 색이면 아직 안 본 것과 이미 되돌려 보낸 것이 구분되지 않는다.
 */
export const MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS = {
  NOT_SUBMITTED: 'closed',
  PENDING: 'recruiting',
  REPENDING: 'recruiting',
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'pending',
  REJECTED: 'rejected',
} as const satisfies Readonly<
  Record<
    MilestoneDocumentReviewDisplay,
    'closed' | 'recruiting' | 'approved' | 'pending' | 'rejected'
  >
>;

/** 판정 버튼 세 개의 순서 — 승인 · 보완 요청 · 반려. */
export const MILESTONE_DOCUMENT_REVIEW_DECISION_ORDER: readonly MilestoneDocumentReviewDecision[] =
  ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'];

/**
 * 제출이 있는 자리의 상태 → 배지. 교직원 칸과 학생 줄이 **같은 함수**를 지난다 —
 * 두 화면이 같은 제출을 다른 말로 부르면 안 되기 때문이다.
 *
 * `SUBMITTED`가 「검토 대기」인 것은 재제출이 상태를 그리로 되돌리기 때문이다: 보완
 * 요청에 응해 다시 낸 제출은 아직 아무도 안 본 제출과 같은 자리에 선다. 상태가 비어
 * 오는 것(`null`)도 검토 대기로 읽는다 — 제출은 있는데 상태만 어긋난 응답에서 「미제출」
 * 이라고 말하면 교직원이 그 건을 아예 못 본다.
 */
function submittedDisplay(
  status: MilestoneDocumentSubmissionStatus | null,
  revision: number | null | undefined,
): MilestoneDocumentReviewDisplay {
  if (status === null) return 'PENDING';
  if (status === 'SUBMITTED') {
    return revision !== null && revision !== undefined && revision > 1
      ? 'REPENDING'
      : 'PENDING';
  }
  return status;
}

/**
 * 교직원 표의 칸 하나. 미제출이 가장 먼저다 — 미제출 칸에 상태·판정이 실려 오는 일은
 * 계약상 없지만, 그 순서를 뒤집으면 어긋난 응답 한 건이 「안 낸 팀이 승인됨」으로 보인다.
 *
 * ⚠ 배지는 `status`로 정한다. **`review.decision`으로 되돌리지 마라** — 판정 이력은
 * 재제출로 되돌아가지 않으므로, 보완 요청을 받아 **다시 낸 칸이 계속 「보완 요청」**으로
 * 남는다. 교직원은 그 칸을 이미 처리한 것으로 읽고 다시 검토해야 할 건을 놓친다.
 * `review`는 패널에서 「지난 검토」를 보여 주는 데만 쓴다.
 */
export function milestoneDocumentCellDisplay(
  cell: Pick<MilestoneDocumentCollectionCell, 'isSubmitted' | 'status'> & {
    readonly revision?: number | null;
  },
): MilestoneDocumentReviewDisplay {
  if (!cell.isSubmitted) return 'NOT_SUBMITTED';
  return submittedDisplay(cell.status, cell.revision);
}

/**
 * 학생 목록의 한 줄. 교직원 칸과 같은 규칙이다 — 보완 요청을 받아 다시 낸 학생에게
 * 계속 「보완 요청」이라고 말하면 안 낸 것처럼 읽힌다.
 */
export function milestoneDocumentViewerDisplay(
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
): MilestoneDocumentReviewDisplay {
  if (viewerSubmission === undefined || !viewerSubmission.submitted) {
    return 'NOT_SUBMITTED';
  }
  return submittedDisplay(viewerSubmission.status, viewerSubmission.revision);
}

/**
 * 학생이 지금 (다시) 낼 수 있는가.
 *
 * 백엔드 `domain/milestone-document-review.ts`의 `isResubmissionAllowedAfter`와 같은 규칙을
 * 상태 쪽에서 본 것이다: 승인·반려는 끝난 판정이라 막고(서버도 409 MSD_023으로 막는다),
 * 보완 요청은 「다시 내라」는 뜻이라 연다. 미제출과 검토 대기가 열려 있는 것은 각각 첫
 * 제출과 「아직 끝난 판정이 없음」이다.
 *
 * ⚠ 「보완 요청일 때만」으로 좁히면 **아직 아무도 안 본 제출을 학생이 고칠 수 없게 된다** —
 * 마감 전 교체는 지금도 되는 일이라 그 좁힘은 기능을 하나 없애는 것이다. 반대로 전부
 * 허용으로 넓히면 승인된 서류에 제출 칸이 열리고, 눌러 봐야 409만 돌아온다.
 */
export function isMilestoneDocumentResubmittable(
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
): boolean {
  const status = viewerSubmission?.status ?? null;
  if (status === null) return true;
  switch (status) {
    case 'APPROVED':
    case 'REJECTED':
      return false;
    case 'SUBMITTED':
    case 'CHANGES_REQUESTED':
      return true;
  }
}

/**
 * 마감이 지난 마일스톤에서 제출 입력을 **잠가야** 하는가.
 *
 * 마감(`closed`)은 기본적으로 잠근다. 지나가는 것은 상태가 `CHANGES_REQUESTED`인 자리 —
 * **보완 요청을 받고 아직 응하지 않은 서류 하나뿐**이다. 교직원이 마감 뒤에 「고쳐서 다시
 * 내세요」라고 하는 것은 흔한 일이고, 그때 화면이 잠그면 **교직원이 요청한 재제출을 학생이
 * 낼 수 없다** — 그 요청 자체가 뜻을 잃는다.
 *
 * **한 번 다시 내면 다시 잠긴다.** 재제출은 상태를 `SUBMITTED`로 되돌리므로 이 함수는 그
 * 순간부터 참을 돌려준다 — 그것이 의도다(#1097에서 정한 규칙: 재제출은 한 번, 교직원이
 * 검토하는 동안 내용은 바뀌지 않는다). 「보완 요청은 마감을 지나간다」와 「검토 대기는
 * 마감으로 닫는다」가 겹치는 자리에서는 **뒤쪽이 이긴다**: 재제출로 검토 대기가 된 서류는
 * 지금 교직원 차례이고, 그 사이에 내용이 바뀌면 교직원이 보지 않은 것에 판정이 붙는다.
 *
 * 서버도 같은 두 값(최신 판정 · 제출 상태)으로 같은 답을 낸다 —
 * `apps/backend/src/milestone-documents/domain/milestone-document-submission-window.ts`의
 * `isChangeRequestResubmissionOpen`이다. 그쪽을 뚫고 들어가면 422(MSD_031)로 막힌다.
 * 한쪽만 고치면 #1097이 그대로 돌아온다.
 *
 * **그 한 번도 교직원이 정한 재제출 기한 안에서만 열린다.** 보완 요청을 저장할 때 기한이
 * 함께 정해지므로(판정 패널에서 필수), 그 시각이 지나면 아직 응하지 않은 서류도 잠긴다.
 * 서버는 그 자리를 422(MSD_034)로 막는다.
 *
 * ⚠ 다른 상태를 함께 풀지 마라.
 * - 승인·반려는 마감과 무관하게 재제출 자체가 금지다 —
 *   `isMilestoneDocumentResubmittable`이 이미 막고, 서버도 409(MSD_023)로 막는다.
 * - 보완 요청을 거치지 않은 미제출·검토 대기는 마감으로 닫히는 것이 **의도된 마감**이다.
 *   여기까지 풀면 마감이 아무것도 막지 않는 표시가 된다.
 */
export function isMilestoneDocumentDeadlineLocked(
  closed: boolean,
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
  now: number = Date.now(),
): boolean {
  if (!closed) return false;
  if (viewerSubmission?.status !== 'CHANGES_REQUESTED') return true;
  return isMilestoneDocumentResubmissionDueAtPassed(viewerSubmission, now);
}

/**
 * 교직원이 정한 재제출 기한이 지났는가.
 *
 * ⚠ `resubmissionDueAt`이 `null`이면 **지나지 않은 것**이다. 그 `null`은 「기한 없음」이 아니라
 * 「이 값이 생기기 전에 저장된 보완 요청」이고, 「지났다」로 읽으면 배포되는 순간 이미
 * 「고쳐서 다시 내세요」를 받고 아직 응하지 않은 학생이 낼 길을 잃는다. 서버도 같은 답을 낸다
 * (`hasMilestoneDocumentResubmissionDueAtPassed`) — 여기만 바꾸면 화면은 잠갔는데 서버는 받아
 * 주는(또는 그 반대의) 어긋남이 돌아온다.
 *
 * 시각을 인자로 받는 것은 마일스톤 마감(`isPastDue`)과 같은 이유다 — 테스트가 달력에 기대지
 * 않게 한다.
 */
export function isMilestoneDocumentResubmissionDueAtPassed(
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
  now: number = Date.now(),
): boolean {
  const dueAt = viewerSubmission?.review?.resubmissionDueAt ?? null;
  if (dueAt === null) return false;
  return isPastDue(dueAt, now);
}

/**
 * 지금 내면 **되돌릴 수 없는가** — 확인 창을 띄울 자리인지 정한다.
 *
 * 마감 뒤 「아직 응하지 않은 보완 요청」에 응하는 제출만 참이다. 그 제출이 상태를
 * `SUBMITTED`로 되돌리는 순간 `isMilestoneDocumentDeadlineLocked`가 참이 되어 입력이 다시
 * 잠기기 때문이다 — **기한이 남아 있어도** 그렇다. 확인 창이 말해야 하는 것이 정확히 그
 * 사실이다.
 *
 * ⚠ 모든 제출에 확인 창을 띄우지 마라. 마감 전 교체는 몇 번이든 되는 일이라 그 자리에서
 * 「더 이상 바꿀 수 없습니다」는 **거짓말**이고, 거짓인 경고를 매번 보는 사람은 곧 읽지 않고
 * 누르게 된다 — 그러면 정작 되돌릴 수 없는 자리에서도 안 읽는다.
 */
export function isMilestoneDocumentResubmissionFinal(
  closed: boolean,
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
): boolean {
  return closed && viewerSubmission?.status === 'CHANGES_REQUESTED';
}

/**
 * 학생 줄에 재제출 기한을 어떻게 말할 것인가 — 적을 것이 없으면 `null`이다.
 *
 * 세 갈래로 갈린다.
 * - `open` — 아직 응하지 않았고 기한도 남았다. **언제까지인지 말해야** 학생이 계획을 세운다.
 * - `passed` — 기한이 지났다. 이 말이 없으면 버튼이 사라진 이유를 학생이 알 수 없고, 그
 *   문의가 곧 교직원에게 간다.
 * - `null` — 이미 응했거나(그 기한은 지나간 이야기다) 승인·반려거나, 기한이 없던 옛 보완
 *   요청이다.
 *
 * ⚠ 판정(`review.decision`)이 아니라 **제출 상태**로 갈래를 정한다. 판정 이력은 재제출로
 * 되돌아가지 않으므로, 판정을 보면 이미 다시 낸 학생에게도 「언제까지 다시 내세요」가 계속
 * 남는다(같은 이유로 배지도 상태를 본다).
 */
export function milestoneDocumentResubmissionDueNotice(
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
  now: number = Date.now(),
): { readonly kind: 'open' | 'passed'; readonly dueAt: string } | null {
  if (viewerSubmission?.status !== 'CHANGES_REQUESTED') return null;
  const dueAt = viewerSubmission.review?.resubmissionDueAt ?? null;
  if (dueAt === null) return null;
  return {
    kind: isMilestoneDocumentResubmissionDueAtPassed(viewerSubmission, now)
      ? 'passed'
      : 'open',
    dueAt,
  };
}

/**
 * 학생에게 사유 상자를 눈에 띄게 띄워야 하는가 — 보완 요청·반려일 때뿐이다.
 * 승인에 붙은 사유는 되돌려 보내는 말이 아니라 덧붙임이라 경고 톤으로 키우지 않는다.
 */
export function shouldHighlightMilestoneDocumentReview(
  display: MilestoneDocumentReviewDisplay,
): boolean {
  return display === 'CHANGES_REQUESTED' || display === 'REJECTED';
}

/**
 * 학생 줄에 사유 상자를 어떤 톤으로 그릴 것인가. 그리지 않을 자리는 `null`이다.
 *
 * - `warning` — 보완 요청·반려. **고쳐야 할 일**이라 눈에 띄어야 한다.
 * - `neutral` — 승인. 판정 폼은 사유를 두고 「학생에게 그대로 보입니다」라고 적어 두므로
 *   승인에 적은 말도 학생에게 닿아야 한다. 다만 같은 경고 상자에 담으면 **승인인데
 *   문제가 있는 것처럼** 읽혀, 「잘 받았습니다」가 반려처럼 보인다.
 *
 * ⚠ 톤만 다른 것이 아니라 **빈 사유를 다루는 법도 다르다.**
 * - 승인은 사유가 선택이라 비어 오는 것이 정상이다. 그때 상자를 그리면 배지가 이미
 *   말한 「승인」 아래에 빈 상자만 남는다 — 그래서 그리지 않는다.
 * - 보완 요청·반려는 사유가 필수라(서버 422 MSD_021) 비어 오는 것이 계약에 없다. 그래도
 *   상자는 그린다: 사유를 못 읽었다고 **되돌아왔다는 사실과 그 날짜까지** 지우면, 학생은
 *   서류가 되돌아온 줄도 모른다. 그 자리는 화면이 「사유 없이 저장되었습니다」라고 적는다.
 */
export type MilestoneDocumentReviewNoticeTone = 'warning' | 'neutral';

export function milestoneDocumentReviewNoticeTone(
  display: MilestoneDocumentReviewDisplay,
  comment: string | null,
): MilestoneDocumentReviewNoticeTone | null {
  if (shouldHighlightMilestoneDocumentReview(display)) return 'warning';
  if (display !== 'APPROVED') return null;
  // 공백만 적힌 사유는 서버가 `null`로 접어 저장하지만, 화면이 그것에 기대지 않는다 —
  // 여기서 보지 않으면 공백 한 칸이 빈 상자를 하나 세운다.
  return comment !== null && comment.trim() !== '' ? 'neutral' : null;
}

/** 이 판정으로 저장하려면 사유가 있어야 하는가. */
export function isMilestoneDocumentReviewCommentRequired(
  decision: MilestoneDocumentReviewDecision,
): boolean {
  return decision === 'CHANGES_REQUESTED' || decision === 'REJECTED';
}

/**
 * 판정 입력이 저장 가능한가. 저장할 수 있으면 `null`, 아니면 교직원에게 보일 문구다.
 *
 * 사유를 `trim()`으로 보는 것은 서버가 그렇게 보기 때문이다 — 공백만 적어 보내면 서버가
 * 빈 문자열을 `null`로 접어 422(MSD_021)로 거절한다. 화면이 공백을 통과시키면 교직원은
 * 「적었는데 안 된다」를 보게 된다.
 */
export function milestoneDocumentReviewFormError(
  decision: MilestoneDocumentReviewDecision | null,
  comment: string,
  resubmissionDueAt = '',
  now: number = Date.now(),
): string | null {
  if (decision === null) return '승인, 보완 요청, 반려 중 하나를 골라 주세요.';
  if (
    isMilestoneDocumentReviewCommentRequired(decision) &&
    comment.trim() === ''
  ) {
    return '보완 요청과 반려는 사유를 입력해 주세요.';
  }
  if (comment.length > MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH) {
    return `사유는 ${MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH.toLocaleString('ko-KR')}자까지 쓸 수 있습니다.`;
  }
  return milestoneDocumentResubmissionDueAtError(
    decision,
    resubmissionDueAt,
    now,
  );
}

/**
 * 재제출 기한 칸이 저장 가능한가 — 저장할 수 있으면 `null`, 아니면 교직원에게 보일 문구다.
 *
 * 세 갈래를 각각 다른 말로 돌려주는 이유는 **교직원이 할 일이 다르기** 때문이다: 비었으면
 * 고르라고, 못 읽는 값이면 다시 고르라고, 지난 시각이면 앞으로 옮기라고 해야 한다. 한 문구로
 * 묶으면 「형식을 확인해 주세요」 같은 말이 되어 무엇을 고칠지 알 수 없다.
 *
 * 지난 시각을 막는 것이 이 검사의 요점이다. 그대로 저장되면 보완 요청이 만들어지는 순간 이미
 * 닫혀 있어 **「다시 내세요」가 사실상 반려**가 된다 — 학생은 요청을 받고도 낼 수 없고, 교직원
 * 화면에는 아무 잘못도 보이지 않는다. 서버도 같은 자리를 422(MSD_032·MSD_033)로 막는다.
 */
export function milestoneDocumentResubmissionDueAtError(
  decision: MilestoneDocumentReviewDecision,
  resubmissionDueAt: string,
  now: number = Date.now(),
): string | null {
  if (decision !== 'CHANGES_REQUESTED') return null;
  if (resubmissionDueAt.trim() === '') {
    return '보완 요청은 재제출 기한을 정해 주세요.';
  }
  const parsed = new Date(resubmissionDueAt).getTime();
  if (!Number.isFinite(parsed)) {
    return '재제출 기한을 다시 골라 주세요.';
  }
  if (parsed <= now) {
    return '재제출 기한은 지금보다 뒤여야 합니다.';
  }
  return null;
}

/**
 * 입력 칸(`datetime-local`)의 값을 요청에 실을 ISO 8601로 바꾼다. 보낼 수 없으면 `undefined`다.
 *
 * `datetime-local`은 **표준시대(timezone) 없는** 문자열('2026-09-26T18:00')을 준다. 그대로
 * 보내면 서버가 그것을 어느 시각으로 읽을지 이 화면이 정하지 못한다 — 브라우저의 지역 시각으로
 * 해석해 ISO로 굳혀 보내야 교직원이 화면에서 고른 그 순간이 그대로 저장된다.
 */
export function milestoneDocumentResubmissionDueAtPayload(
  decision: MilestoneDocumentReviewDecision,
  resubmissionDueAt: string,
): string | undefined {
  if (decision !== 'CHANGES_REQUESTED') return undefined;
  const parsed = new Date(resubmissionDueAt);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * 요청 본문에 실을 사유. 공백만 남으면 아예 싣지 않는다(`undefined`) — 승인에 공백을
 * 실어 보내면 학생 화면에 「사유: (빈칸)」이 남는다.
 */
export function milestoneDocumentReviewCommentPayload(
  comment: string,
): string | undefined {
  const trimmed = comment.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** 판정 패널이 열려 있는 칸 하나 — 팀 × 서류로 한 자리가 정해진다. */
export interface MilestoneDocumentReviewTarget {
  readonly applicationId: string;
  readonly documentId: string;
}

/**
 * 「내가 본 그 제출물」의 표시. 판정 요청에 그대로 실려 나가 서버가 대조한다
 * (`MilestoneDocumentReviewInput`의 같은 이름 두 필드).
 */
export interface MilestoneDocumentReviewVersion {
  /**
   * 칸의 `revision` — 그 제출물이 **몇 번째 제출본인가**. 제출 시각이 아니라 번호로
   * 대조한다: 같은 초에 두 번 낸 재제출은 시각이 같아 「바뀌지 않았다」로 통과했다.
   */
  readonly expectedRevision: number;
  readonly expectedLatestReviewId: string | null;
}

/**
 * 패널을 **열 때** 칸에서 떠 오는 버전. 전송하는 순간에 표를 다시 읽어 채우면 언제나
 * 최신값이 실려 서버의 대조가 늘 통과한다 — 그러면 표를 그린 뒤 학생이 다시 낸 내용이나
 * 다른 교직원이 먼저 붙인 판정을 **못 본 채로** 판정이 얹힌다. 검사가 뜻을 가지려면
 * 교직원이 실제로 눈으로 본 그 값이어야 한다.
 *
 * 제출본 번호가 없는 칸은 `null`을 돌려준다. 계약상 제출된 칸에는 늘 번호가 있고 패널도
 * 제출된 칸에만 열리지만, 어긋난 응답 하나로 **아무 값이나 지어내 보내는** 일이
 * 없어야 한다 — 지어낸 값은 대조를 통과하고, 그 통과는 거짓이다. 특히 `?? 0`이나
 * `?? 1` 같은 기본값은 절대 두지 마라: 그것은 「못 읽었다」를 「1번 제출본을 봤다」로
 * 바꿔 말하는 것이다.
 *
 * 1보다 작은 번호도 같이 버린다. 첫 제출이 1이라 0·음수는 **어떤 제출도 가리키지 않고**,
 * 서버도 그렇게 본다(요청 DTO의 `@Min(1)`). 그대로 실어 보내면 교직원은 「요청 값을
 * 확인해 주세요」라는 400을 받는데 그가 고칠 수 있는 것이 아무것도 없다 — 여기서 버리면
 * 대신 「표를 다시 불러 주세요」라고 말할 수 있다(`milestoneDocumentReviewVersionError`).
 */
export function milestoneDocumentReviewVersionOf(
  cell: Pick<MilestoneDocumentCollectionCell, 'revision' | 'review'>,
): MilestoneDocumentReviewVersion | null {
  if (cell.revision === null || cell.revision < 1) return null;
  return {
    expectedRevision: cell.revision,
    // 판정이 아직 없던 칸은 `null`을 **명시해서** 보낸다 — 키를 빼면 400이다.
    expectedLatestReviewId: cell.review?.id ?? null,
  };
}

/**
 * 기대 버전을 못 떠 온 채로 저장하려 할 때 교직원에게 보일 문구. 보낼 수 있으면 `null`.
 *
 * 이 자리에서 막는 대신 「검사 없이 보내기」로 물러나면, 응답 하나가 어긋난 날 그 칸만
 * 조용히 무검사 판정 경로가 된다.
 */
export function milestoneDocumentReviewVersionError(
  version: MilestoneDocumentReviewVersion | null,
): string | null {
  return version === null
    ? '이 칸의 제출 정보를 읽지 못해 검토할 수 없습니다. 표를 다시 불러 주세요.'
    : null;
}

export function isSameMilestoneDocumentReviewTarget(
  a: MilestoneDocumentReviewTarget,
  b: MilestoneDocumentReviewTarget,
): boolean {
  return a.applicationId === b.applicationId && a.documentId === b.documentId;
}

/** 열려 있는 판정 패널의 상태 전부. 컨테이너가 갖고 화면은 그리기만 한다. */
export interface MilestoneDocumentReviewFormState {
  readonly target: MilestoneDocumentReviewTarget;
  /**
   * 이 패널을 **열던 순간** 칸에 있던 제출물의 표시. 표가 그 뒤에 바뀌어도 이 값은 따라
   * 바뀌지 않는다 — 판정은 교직원이 눈으로 본 그 제출물에 묶여야 하고, 그것이 이미
   * 바뀌었다면 저장이 아니라 409로 막히는 편이 맞다.
   */
  readonly version: MilestoneDocumentReviewVersion | null;
  readonly decision: MilestoneDocumentReviewDecision | null;
  readonly comment: string;
  /**
   * 재제출 기한 칸의 날것 그대로 — `datetime-local`이 주는 지역 시각 문자열이다
   * ('2026-09-26T18:00'). 보완 요청일 때만 뜻이 있고, ISO로 굳히는 것은 보낼 때 한 번이다
   * (`milestoneDocumentResubmissionDueAtPayload`).
   *
   * 판정을 바꿔도 이 값을 지우지 않는다 — 보완 요청을 골라 날짜를 적다가 승인을 눌러 보고
   * 다시 보완 요청으로 돌아온 교직원이 적어 둔 것을 잃지 않는다. 승인·반려로 저장할 때는
   * payload가 떨어뜨리므로 새어 나가지 않는다.
   */
  readonly resubmissionDueAt: string;
  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;
  readonly history: readonly MilestoneDocumentCollectionHistory[];
  readonly historyNextCursor: string | null;
  readonly historyIsComplete: boolean;
  readonly isHistoryLoading: boolean;
  readonly historyError: string | null;
}

export function createMilestoneDocumentReviewFormState(
  target: MilestoneDocumentReviewTarget,
  version: MilestoneDocumentReviewVersion | null,
): MilestoneDocumentReviewFormState {
  return {
    target,
    version,
    decision: null,
    comment: '',
    resubmissionDueAt: '',
    isSubmitting: false,
    errorMessage: null,
    history: [],
    historyNextCursor: null,
    historyIsComplete: true,
    isHistoryLoading: true,
    historyError: null,
  };
}

/**
 * 칸을 눌렀을 때의 다음 상태 — 같은 칸을 다시 누르면 닫고, 다른 칸이면 새로 연다.
 *
 * 다른 칸으로 옮길 때 입력을 이어받지 않는 것이 요점이다. 교직원은 여러 건을 연달아
 * 처리하는데, 앞 팀에 적던 사유가 다음 팀 칸에 남아 있으면 그대로 저장돼 **엉뚱한 팀에
 * 남의 지적이 붙는다**. 그 사유는 학생에게 그대로 보인다.
 */
export function nextMilestoneDocumentReviewState(
  current: MilestoneDocumentReviewFormState | null,
  target: MilestoneDocumentReviewTarget,
  version: MilestoneDocumentReviewVersion | null,
): MilestoneDocumentReviewFormState | null {
  if (
    current !== null &&
    isSameMilestoneDocumentReviewTarget(current.target, target)
  ) {
    return null;
  }
  return createMilestoneDocumentReviewFormState(target, version);
}
