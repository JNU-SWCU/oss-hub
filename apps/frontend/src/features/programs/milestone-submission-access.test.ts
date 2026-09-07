import { describe, expect, it } from 'vitest';
import {
  milestoneSubmissionAccess,
  type MilestoneSubmissionAccess,
} from './milestone-submission-access';
import type { ApplicationStatus, ViewerRole } from './types';

function access(
  role: ViewerRole,
  applicationStatus: ApplicationStatus | null = null,
): MilestoneSubmissionAccess {
  return milestoneSubmissionAccess({ role, applicationStatus });
}

describe('milestoneSubmissionAccess', () => {
  /**
   * 변이 검증 대상 — 승인된 학생까지 막으면 첫 제출과 마감 전 교체가 함께 사라진다.
   * 이 티켓이 좁히는 것은 신청이 없는 사람이지 승인된 사람이 아니다.
   */
  it('승인된 학생에게는 문을 열어 둔다', () => {
    expect(access('STUDENT', 'APPROVED')).toEqual({ kind: 'open' });
  });

  /**
   * 교직원·관리자는 학생용 제출 행 자체를 보지 않고, 역할이 없는 사람에게는 블록이
   * 그려지지 않는다. 이 문은 학생 하나에만 걸린다.
   */
  it('학생이 아닌 사람은 이 문의 대상이 아니다', () => {
    for (const role of ['STAFF', 'ADMIN', 'PENDING', null] as const) {
      expect(access(role)).toEqual({ kind: 'open' });
    }
  });

  /**
   * 세 문구가 달라야 하는 이유는 **학생이 다음에 할 일이 다르기** 때문이다. 신청 전은
   * 신청서를 써야 하고, 승인 대기는 기다리면 되고, 반려는 기다려도 열리지 않아
   * 교직원이 되돌려 주어야 한다. 한 문구로 합치면 아직 신청서도 쓰지 않은 학생이 오지
   * 않을 승인을 기다리고, 반려된 학생도 같은 헛된 기다림에 들어간다.
   */
  it('신청 전·승인 대기·반려의 문구가 서로 다르다', () => {
    const notices = ([null, 'SUBMITTED', 'REJECTED'] as const).map((status) => {
      const result = access('STUDENT', status);
      if (result.kind !== 'blocked') {
        throw new TypeError(`막혀야 하는 상태입니다: ${String(status)}`);
      }
      return result.notice;
    });

    expect(new Set(notices).size).toBe(3);
  });

  it('신청 전에는 신청부터 하라고 말한다', () => {
    const result = access('STUDENT', null);
    if (result.kind !== 'blocked') throw new TypeError('막혀야 합니다.');

    expect(result.reason).toBe('NOT_APPLIED');
    expect(result.notice).toBe('이 프로그램에 신청해야 제출할 수 있습니다.');
    expect(result.buttonNote).toBe('신청 후 제출할 수 있습니다');
  });

  it('승인 대기에는 기다리라고 말한다', () => {
    const result = access('STUDENT', 'SUBMITTED');
    if (result.kind !== 'blocked') throw new TypeError('막혀야 합니다.');

    expect(result.reason).toBe('AWAITING_DECISION');
    expect(result.notice).toBe(
      '신청 승인을 기다리는 중입니다. 승인되면 제출할 수 있습니다.',
    );
    expect(result.buttonNote).toBe('승인 후 제출할 수 있습니다');
  });

  /**
   * #1098이 **일부러 비워 둔 자리**였다(`kind: 'unchanged'`) — 반려 학생에게 무엇을
   * 보여줄지는 반려 사유를 어디서 읽게 할지와 함께 정해야 하는 판단이라 그 티켓에서는
   * 답을 지어내지 않았다. #1206에서 답이 정해졌고, 근거는 셋이다.
   *
   *   1. 서버 규칙이 「반려가 아니면 통과」가 아니라 **「승인이면 통과」**다
   *      (`if (!application.approved) 403 MSD_006`). 제출도 파일 업로드도 함께 거절되므로
   *      화면을 잠그는 것은 없던 제약을 만드는 게 아니라 있는 제약을 옮겨 적는 것이다.
   *   2. 반려 사유가 학생에게 닿는 통로는 신청 상세 하나뿐이고, 학생 대시보드의 반려
   *      알림도 이미 같은 곳으로 보낸다 — 두 화면이 같은 말을 해야 헷갈리지 않는다.
   *   3. 그래서 문구는 승인 대기와 달라야 한다. 승인 대기는 기다리면 열리지만 반려는
   *      교직원이 「검토 대기로」를 눌러 주어야만 열린다.
   *
   * 변이 검증 대상 — 다시 `unchanged`(또는 `open`)로 돌리면 여기가 깨진다.
   */
  it('반려된 신청은 잠그고 그 이유를 말한다', () => {
    const result = access('STUDENT', 'REJECTED');
    if (result.kind !== 'blocked') throw new TypeError('막혀야 합니다.');

    expect(result.reason).toBe('REJECTED_APPLICATION');
    expect(result.notice).toBe(
      '신청이 반려되어 제출할 수 없습니다. 반려 사유는 신청 상세에서 확인할 수 있습니다.',
    );
    expect(result.buttonNote).toBe('반려된 신청은 제출할 수 없습니다');
  });

  /**
   * 반려 학생이 **실제로 갈 수 없는 곳**을 가리키지 않는다. 반려된 신청서는 수정도 취소도
   * 되지 않고, 한 팀당 신청은 하나이며 신청이 붙은 팀에서는 나갈 수도 없다 — 「다시 신청」을
   * 내밀면 학생은 「수정할 수 없는 신청입니다」만 만나고 돌아온다.
   *
   * 승인 대기 문구를 그대로 재사용하는 것도 막는다. 검토 대기 학생은 기다리면 열리지만
   * 반려 학생은 기다려도 열리지 않는다.
   */
  it('반려 문구는 갈 수 없는 길을 내밀지 않는다', () => {
    const result = access('STUDENT', 'REJECTED');
    if (result.kind !== 'blocked') throw new TypeError('막혀야 합니다.');

    for (const text of [result.notice, result.buttonNote]) {
      expect(text).not.toContain('다시 신청');
      expect(text).not.toContain('승인 후 제출할 수 있습니다');
    }
  });
});
