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
 *
 * ⚠ 다음에 할 일로 데려가는 경로는 여기서 주지 않는다. 「신청하기」는 페이지 상단 헤더
 * (`ProgramActions`)에 이미 하나 서 있고, 마일스톤은 프로그램마다 여럿이라 줄마다 같은
 * 버튼을 다시 세우면 한 화면에 같은 목적지가 몇 번씩 반복된다. 이 파일이 정하는 것은
 * **왜 못 내는지**까지다.
 */

/**
 * 못 내는 세 갈래. 학생이 다음에 할 일이 서로 달라 문구도 갈린다 — 신청 전은 신청서를
 * 써야 하고, 승인 대기는 기다리면 되고, 반려는 **기다려도 열리지 않는다**.
 */
export type MilestoneSubmissionBlockedReason =
  'NOT_APPLIED' | 'AWAITING_DECISION' | 'REJECTED_APPLICATION';

export interface BlockedMilestoneSubmissionAccess {
  readonly kind: 'blocked';
  readonly reason: MilestoneSubmissionBlockedReason;
  /** 마일스톤 줄에 적는 한 문장 — 왜 못 내는지. */
  readonly notice: string;
  /**
   * 흐려진 버튼 **옆**에 적는 짧은 이유. `notice`와 한자리에서 함께 정하므로 둘이
   * 어긋날 수 없다 — 줄마다 반복되는 자리라 문장은 짧게 둔다.
   */
  readonly buttonNote: string;
}

export type MilestoneSubmissionAccess =
  { readonly kind: 'open' } | BlockedMilestoneSubmissionAccess;

const OPEN = { kind: 'open' } as const satisfies MilestoneSubmissionAccess;

/**
 * 학생이 아닌 사람은 이 문이 대상이 아니다 — 교직원·관리자는 서류 수합 쪽 행을 보고,
 * 역할이 없거나 `PENDING`인 사람에게는 제출 항목 블록 자체가 그려지지 않는다.
 */
export function milestoneSubmissionAccess(viewer: {
  readonly role: ViewerRole;
  readonly applicationStatus: ApplicationStatus | null;
}): MilestoneSubmissionAccess {
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
      };
    case 'SUBMITTED':
      // 신청서는 냈고 판정을 기다린다 — 학생이 지금 더 할 수 있는 일이 없다.
      return {
        kind: 'blocked',
        reason: 'AWAITING_DECISION',
        notice: '신청 승인을 기다리는 중입니다. 승인되면 제출할 수 있습니다.',
        buttonNote: '승인 후 제출할 수 있습니다',
      };
    case 'REJECTED':
      /*
       * #1098은 이 갈래를 **일부러 비워 두었다**(`kind: 'unchanged'`) — 반려 학생에게
       * 무엇을 보여줄지는 반려 사유를 어디서 읽게 할지와 함께 정해야 하는 판단이라
       * 그 티켓에서 답을 지어내지 않았다. 그동안 화면은 「올리기」를 눌리는 채로 두었고,
       * 파일까지 고른 학생이 그제서야 403(MSD_006)을 받았다. #1206에서 답을 정한다.
       *
       * 왜 이제 정해졌나 — 세 가지가 확인됐다.
       *   1. 서버 규칙은 「반려가 아니면 통과」가 아니라 **「승인이면 통과」**다
       *      (`if (!application.approved) 403 MSD_006`). 제출도 파일 업로드도 함께
       *      거절되므로 잠그는 것은 없던 제약을 만드는 게 아니라 있는 제약을 옮겨 적는
       *      것이다. 검토 대기가 이미 잠겨 있는 이상 반려만 열어 둘 근거가 없다.
       *   2. 반려 사유가 학생에게 닿는 통로는 **신청 상세 화면 하나뿐**이고, 학생
       *      대시보드의 반려 알림도 이미 같은 곳으로 보낸다. 두 화면이 같은 말을 한다.
       *   3. 그러므로 문구는 승인 대기와 **달라야 한다** — 승인 대기는 기다리면 열리지만
       *      반려는 교직원이 「검토 대기로」를 눌러 주어야만 열린다.
       *
       * ⚠ 「다시 신청해 주세요」라고 쓰지 않는다. 반려된 신청서는 수정도 취소도 되지 않고,
       * 한 팀당 신청은 하나이며 신청이 붙은 팀에서는 나갈 수도 없다 — 학생이 신청 화면까지
       * 갔다가 「수정할 수 없는 신청입니다」만 만나고 돌아온다. 화면이 내미는 해결책은
       * 실제로 도달 가능한 것이어야 한다(`milestone-submit-gate`의 같은 법칙).
       */
      return {
        kind: 'blocked',
        reason: 'REJECTED_APPLICATION',
        notice:
          '신청이 반려되어 제출할 수 없습니다. 반려 사유는 신청 상세에서 확인할 수 있습니다.',
        buttonNote: '반려된 신청은 제출할 수 없습니다',
      };
  }
}
