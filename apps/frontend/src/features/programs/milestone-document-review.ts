import type { MilestoneDocumentViewerSubmission } from './milestone-document-api';
import type { MilestoneDocumentCollectionCell } from './milestone-document-collection-api';
import {
  MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH,
  type MilestoneDocumentReviewDecision,
} from './milestone-document-review-api';

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
  'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export const MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS = {
  NOT_SUBMITTED: '미제출',
  PENDING: '검토 대기',
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
 * 교직원 표의 칸 하나. 판정은 **제출에 붙으므로** 미제출이 가장 먼저다 — 미제출 칸에
 * 판정이 실려 오는 일은 계약상 없지만, 그 순서를 뒤집으면 어긋난 응답 한 건이
 * 「안 낸 팀이 승인됨」으로 보인다.
 */
export function milestoneDocumentCellDisplay(
  cell: Pick<MilestoneDocumentCollectionCell, 'isSubmitted' | 'review'>,
): MilestoneDocumentReviewDisplay {
  if (!cell.isSubmitted) return 'NOT_SUBMITTED';
  if (cell.review === null) return 'PENDING';
  return cell.review.decision;
}

/**
 * 학생 목록의 한 줄. 상태(`status`)가 판정 결과를 1:1로 담으므로 그것만 보면 된다.
 *
 * `SUBMITTED`가 「검토 대기」인 것은 재제출이 상태를 그리로 되돌리기 때문이다 — 보완
 * 요청을 받아 다시 낸 학생에게 계속 「보완 요청」이라고 말하면 안 낸 것처럼 읽힌다.
 */
export function milestoneDocumentViewerDisplay(
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
): MilestoneDocumentReviewDisplay {
  if (viewerSubmission === undefined || !viewerSubmission.submitted) {
    return 'NOT_SUBMITTED';
  }
  const { status } = viewerSubmission;
  if (status === null || status === 'SUBMITTED') return 'PENDING';
  return status;
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
 * 학생에게 사유 상자를 눈에 띄게 띄워야 하는가 — 보완 요청·반려일 때뿐이다.
 * 승인에 붙은 사유는 되돌려 보내는 말이 아니라 덧붙임이라 경고 톤으로 키우지 않는다.
 */
export function shouldHighlightMilestoneDocumentReview(
  display: MilestoneDocumentReviewDisplay,
): boolean {
  return display === 'CHANGES_REQUESTED' || display === 'REJECTED';
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
): string | null {
  if (decision === null) return '판정을 골라 주세요.';
  if (
    isMilestoneDocumentReviewCommentRequired(decision) &&
    comment.trim() === ''
  ) {
    return '보완 요청과 반려는 사유를 입력해 주세요.';
  }
  if (comment.length > MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH) {
    return `사유는 ${MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH.toLocaleString('ko-KR')}자까지 쓸 수 있습니다.`;
  }
  return null;
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

export function isSameMilestoneDocumentReviewTarget(
  a: MilestoneDocumentReviewTarget,
  b: MilestoneDocumentReviewTarget,
): boolean {
  return a.applicationId === b.applicationId && a.documentId === b.documentId;
}

/** 열려 있는 판정 패널의 상태 전부. 컨테이너가 갖고 화면은 그리기만 한다. */
export interface MilestoneDocumentReviewFormState {
  readonly target: MilestoneDocumentReviewTarget;
  readonly decision: MilestoneDocumentReviewDecision | null;
  readonly comment: string;
  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;
}

export function createMilestoneDocumentReviewFormState(
  target: MilestoneDocumentReviewTarget,
): MilestoneDocumentReviewFormState {
  return {
    target,
    decision: null,
    comment: '',
    isSubmitting: false,
    errorMessage: null,
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
): MilestoneDocumentReviewFormState | null {
  if (
    current !== null &&
    isSameMilestoneDocumentReviewTarget(current.target, target)
  ) {
    return null;
  }
  return createMilestoneDocumentReviewFormState(target);
}
