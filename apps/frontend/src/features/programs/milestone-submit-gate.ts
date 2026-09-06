import type { MilestoneDocumentViewerSubmission } from './milestone-document-api';
import {
  isMilestoneDocumentDeadlineLocked,
  isMilestoneDocumentResubmittable,
  milestoneDocumentViewerDisplay,
} from './milestone-document-review';
import type {
  BlockedMilestoneSubmissionAccess,
  MilestoneSubmissionAccess,
} from './milestone-submission-access';
import { isPastDue } from './program-detail-format';
import type { ProgramMilestone, SubmissionStatus } from './types';

/**
 * 학생을 막고 있는 것이 **여럿일 때 무엇을 먼저 말할 것인가**.
 *
 * `milestoneSubmissionAccess`(신청 하나)와 `milestone-document-review`(서류 하나)는 각각
 * 자기 몫만 본다. 둘 다 「못 낸다」고 할 때 화면이 고를 문장을 정하는 자리가 여기다.
 *
 * ⚠ 법칙 하나 — **화면이 내미는 해결책은 실제로 도달 가능한 것이어야 한다.**
 * 신청이 승인돼도 열리지 않는 줄에 「승인 후 제출할 수 있습니다」라고 적으면, 학생은
 * 기다린 뒤 같은 자리에서 같은 벽을 다시 만난다 — 서버는 그때도 재제출을 거절한다
 * (MSD_023). 그래서 순서는 **신청이 풀 수 없는 것부터**다:
 *
 *   1. 그 서류·그 줄의 판정이 이미 끝났다(승인·반려) — 신청 승인도 이것을 되돌리지 못한다.
 *   2. 마감이 지났다 — 신청이 승인돼도 지나간 마감은 돌아오지 않는다.
 *   3. 신청 상태(신청 전·승인 대기) — **이것만이** 학생이 기다리면 풀리는 것이다.
 *
 * 이 순서가 드러나는 자리가 **되돌린 승인**(APPROVED → SUBMITTED)이다. 되돌린 시점에 이미
 * 승인·반려된 서류가 남아 있는데, 신청 상태를 먼저 보면 그 줄들이 전부 「승인 후 제출할 수
 * 있습니다」라고 말한다. 같은 뒤집힘이 **마감이 지난 첫 제출**도 「승인되면 가능해진다」고
 * 말하게 한다.
 *
 * ⚠ 반대로 신청 게이트를 아래로 더 내리지 마라. 신청서를 아직 쓰지 않은 학생에게는 서류
 * 판정도 마감도 걸리는 것이 없어(제출본이 없다) 3번이 곧 그가 할 수 있는 유일한 일이다.
 */

/** 서류 한 줄의 제출 자리에 무엇을 그릴 것인가. */
export type MilestoneDocumentSubmitGate =
  /** 낼 수 있다 — 버튼을 세운다. */
  | { readonly kind: 'open' }
  /**
   * 이 서류의 판정이 끝났다. 버튼 자체를 걷고 이유만 남긴다 — 다시 열릴 일이 없는 자리에
   * 버튼 모양을 남겨 두면 「언젠가는 눌린다」로 읽힌다.
   */
  | { readonly kind: 'settled'; readonly note: string }
  /**
   * 지금은 못 낸다. 눌리지 않는 버튼과 그 옆의 이유를 남긴다 — 자리가 통째로 사라지는
   * 것보다, 왜 흐려져 있는지가 적힌 버튼이 낫다.
   */
  | { readonly kind: 'held'; readonly note: string };

export function milestoneDocumentSubmitGate({
  submissionAccess,
  viewerSubmission,
  closed,
}: {
  readonly submissionAccess: MilestoneSubmissionAccess;
  readonly viewerSubmission: MilestoneDocumentViewerSubmission | undefined;
  /** 마일스톤 마감이 지났는가. */
  readonly closed: boolean;
}): MilestoneDocumentSubmitGate {
  // 1. 승인·반려된 서류. 신청이 다시 승인돼도 서버는 계속 409(MSD_023)로 막는다.
  if (!isMilestoneDocumentResubmittable(viewerSubmission)) {
    return {
      kind: 'settled',
      note:
        milestoneDocumentViewerDisplay(viewerSubmission) === 'APPROVED'
          ? '승인된 제출 항목은 다시 제출할 수 없습니다.'
          : '반려된 제출 항목은 다시 제출할 수 없습니다.',
    };
  }
  /*
   * 2. 마감. 보완 요청만 지나간다(`isMilestoneDocumentDeadlineLocked`) — 마감 뒤
   *    「고쳐서 다시 내세요」는 흔한 일이고 서버도 그것만 받는다.
   *
   *    예전에는 이 자리에서 버튼만 흐려지고 이유가 없었다. 신청 안내보다 먼저 서게 된
   *    이상 말없이 흐려 두면 학생은 아무 설명도 못 받으므로, 이유를 함께 붙인다.
   */
  if (isMilestoneDocumentDeadlineLocked(closed, viewerSubmission)) {
    return { kind: 'held', note: '마감이 지나 제출할 수 없습니다' };
  }
  // 3. 신청 전·승인 대기. 여기까지 와야 「승인 후 …」가 참이 된다.
  if (submissionAccess.kind === 'blocked') {
    return { kind: 'held', note: submissionAccess.buttonNote };
  }
  return { kind: 'open' };
}

/**
 * 마일스톤 머리줄(레거시 제출 축, `submissionType !== null`)의 제출 자리.
 * 서류 줄과 **같은 순서 법칙**을 따른다 — 한 화면 위아래가 서로 다른 순서로 판단하면
 * 위는 「승인되면 가능」이라 하고 아래는 「이미 끝났다」고 하는 일이 생긴다.
 */
export type MilestoneRowSubmitGate =
  /** 이 줄의 판정이 끝났거나 마감이 지났다 — 배지만 남기고 제출 경로는 세우지 않는다. */
  | { readonly kind: 'settled'; readonly status: SubmissionStatus }
  | {
      readonly kind: 'blocked';
      readonly access: BlockedMilestoneSubmissionAccess;
    }
  /** 반려된 신청 — 이 화면이 아직 답을 정하지 않은 자리다(#1098 범위 밖). */
  | { readonly kind: 'unchanged' }
  /** 신청은 승인됐는데 제출 상태만 비어 왔다. 계약상 오지 않는 값이다. */
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'open';
      readonly status: SubmissionStatus;
      readonly resubmission: boolean;
    };

export function milestoneRowSubmitGate(
  milestone: Pick<ProgramMilestone, 'dueAt' | 'viewerSubmissionStatus'>,
  submissionAccess: MilestoneSubmissionAccess,
): MilestoneRowSubmitGate {
  /*
   * 반려는 순서 법칙보다 앞이다. 이 화면이 반려 학생에게 무엇을 보여줄지는 아직 정하지
   * 않았고(#1098 범위 밖), 답이 정해질 때까지 **#1098 이전 화면 그대로** 두기로 한
   * 자리다 — 상태가 와 있어도 옛 화면은 이 한 줄만 보여 줬다.
   */
  if (submissionAccess.kind === 'unchanged') return { kind: 'unchanged' };
  const status = milestone.viewerSubmissionStatus;
  if (status !== null) {
    const resubmission = status === 'CHANGES_REQUESTED';
    // 승인·반려·최종 판정, 그리고 마감이 지난 첫 제출. 신청이 승인돼도 열리지 않는다.
    if (
      !resubmission &&
      !(status === 'NOT_SUBMITTED' && !isPastDue(milestone.dueAt))
    ) {
      return { kind: 'settled', status };
    }
    if (submissionAccess.kind === 'blocked') {
      return { kind: 'blocked', access: submissionAccess };
    }
    return { kind: 'open', status, resubmission };
  }
  /*
   * 상태가 없다 — 낼 것도 마감도 걸릴 것이 없으니 신청이 곧 유일한 벽이다. 신청서를 아직
   * 쓰지 않은 학생이 여기로 온다(신청이 없으면 제출 상태도 없다).
   */
  if (submissionAccess.kind === 'blocked') {
    return { kind: 'blocked', access: submissionAccess };
  }
  return { kind: 'unknown' };
}
