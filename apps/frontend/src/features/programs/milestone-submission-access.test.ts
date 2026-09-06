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
   * 두 문구가 달라야 하는 이유는 **학생이 다음에 할 일이 다르기** 때문이다. 신청 전은
   * 신청서를 써야 하고, 승인 대기는 기다리면 된다. 한 문구로 합치면 아직 신청서도 쓰지
   * 않은 학생이 오지 않을 승인을 기다린다.
   */
  it('신청 전과 승인 대기의 문구가 서로 다르다', () => {
    const notices = ([null, 'SUBMITTED'] as const).map((status) => {
      const result = access('STUDENT', status);
      if (result.kind !== 'blocked') {
        throw new TypeError(`막혀야 하는 상태입니다: ${String(status)}`);
      }
      return result.notice;
    });

    expect(new Set(notices).size).toBe(2);
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
   * 반려는 **이 티켓에서 다루지 않는다**(#1098). 신청도 하지 않은 학생에게 반려 사유를
   * 언급하는 문구가 생긴 것이 앞선 구현의 문제였고, 반려 학생에게 무엇을 보여줄지는
   * 사유를 어디서 읽게 할지와 함께 따로 정해야 한다.
   *
   * 그때까지 화면은 답을 지어내지 않고 #1098 이전 그대로 둔다 — 여기서 `blocked`가
   * 나오면 마일스톤 줄 문구가 바뀌고 「올리기」가 흐려져, 정하지도 않은 화면이 나간다.
   */
  it('반려는 이 화면이 답을 정하지 않은 상태로 둔다', () => {
    expect(access('STUDENT', 'REJECTED')).toEqual({ kind: 'unchanged' });
  });
});
