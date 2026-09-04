import { programHref } from './program-paths';
import type { ApplicationStatus, ViewerRole } from './types';

/**
 * 한 마일스톤 블록에서 학생이 지금 제출할 수 있는가 — **위(마일스톤 줄)와 아래(제출 항목)가
 * 함께 보는 단 하나의 기준**이다.
 *
 * 이 자리가 따로 생긴 이유(#1098): 위쪽 줄만 신청 상태를 읽고 아래쪽 제출 항목은 그 값을
 * 받지도 못해, 같은 블록이 「신청 승인 후 제출 상태를 확인할 수 있습니다」라고 적어 놓고
 * 바로 아래에 눌리는 「올리기」 버튼을 세워 두었다. 두 자리가 **같은 값을 읽게** 해서 그
 * 어긋남을 없앤다 — 각자 신청 상태를 다시 해석하면 지금까지처럼 한쪽만 바뀐다.
 *
 * ⚠ 이것은 서버의 거절 판정(MSD_005 · MSD_006)을 대신하지 않는다. 화면이 먼저 말해 줄
 * 뿐이고, 저장 여부는 여전히 서버가 정한다. 반대로 여기서 막는 것은 서버도 막는 것뿐이다.
 *
 * ⚠ 서류 하나하나의 판정(승인·반려된 서류는 다시 못 낸다)은 여기가 아니라
 * `isMilestoneDocumentResubmittable`이 본다. 이 파일이 보는 것은 **신청** 하나뿐이다.
 */

/** 못 내는 세 갈래. 학생이 다음에 할 일이 서로 달라 문구도 갈린다. */
export type MilestoneSubmissionBlockedReason =
  'NOT_APPLIED' | 'AWAITING_DECISION' | 'REJECTED';

/** 지금 할 수 있는 일로 데려가는 자리. */
export interface MilestoneSubmissionNextStep {
  readonly label: string;
  readonly href: string;
}

export interface BlockedMilestoneSubmissionAccess {
  readonly kind: 'blocked';
  readonly reason: MilestoneSubmissionBlockedReason;
  /** 마일스톤 줄에 적는 한 문장 — 왜 못 내는지와 다음에 할 일. */
  readonly notice: string;
  /**
   * 흐려진 버튼 **옆**에 적는 짧은 이유. `notice`와 한자리에서 함께 정하므로 둘이
   * 어긋날 수 없다 — 줄마다 반복되는 자리라 문장은 짧게 둔다.
   */
  readonly buttonNote: string;
  /** 없으면 `null`. 신청 전에만 신청 화면으로 가는 경로를 준다. */
  readonly nextStep: MilestoneSubmissionNextStep | null;
}

export type MilestoneSubmissionAccess =
  { readonly kind: 'open' } | BlockedMilestoneSubmissionAccess;

const OPEN = { kind: 'open' } as const satisfies MilestoneSubmissionAccess;

/**
 * 학생이 아닌 사람은 이 문이 대상이 아니다 — 교직원·관리자는 서류 수합 쪽 행을 보고,
 * 역할이 없거나 `PENDING`인 사람에게는 제출 항목 블록 자체가 그려지지 않는다.
 */
export function milestoneSubmissionAccess(
  viewer: {
    readonly role: ViewerRole;
    readonly applicationStatus: ApplicationStatus | null;
  },
  programId: string,
): MilestoneSubmissionAccess {
  if (viewer.role !== 'STUDENT') return OPEN;
  switch (viewer.applicationStatus) {
    case 'APPROVED':
      return OPEN;
    case null:
      // 아직 신청서를 쓰지 않았다 — 다음 할 일은 기다리는 것이 아니라 신청서 쓰기다.
      return {
        kind: 'blocked',
        reason: 'NOT_APPLIED',
        notice: '이 프로그램에 신청해야 제출할 수 있습니다.',
        buttonNote: '신청 후 제출할 수 있습니다',
        nextStep: {
          label: '신청하기',
          href: programHref(programId, '/apply'),
        },
      };
    case 'SUBMITTED':
      // 신청서는 냈고 판정을 기다린다 — 학생이 더 할 일이 없으므로 경로도 주지 않는다.
      return {
        kind: 'blocked',
        reason: 'AWAITING_DECISION',
        notice: '신청 승인을 기다리는 중입니다. 승인되면 제출할 수 있습니다.',
        buttonNote: '승인 후 제출할 수 있습니다',
        nextStep: null,
      };
    case 'REJECTED':
      // 판정이 끝났다 — 기다려도 열리지 않으므로 「기다리세요」라고 말하면 안 된다.
      return {
        kind: 'blocked',
        reason: 'REJECTED',
        notice:
          '신청이 반려되어 제출할 수 없습니다. 반려 사유를 확인해 주세요.',
        buttonNote: '반려되어 제출할 수 없습니다',
        nextStep: null,
      };
  }
}
