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
  return milestoneSubmissionAccess({ role, applicationStatus }, 'program:1');
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
   * 세 상태의 문구가 서로 달라야 하는 이유는 **학생이 다음에 할 일이 다르기** 때문이다.
   * 신청 전은 신청서를 써야 하고, 승인 대기는 기다리면 되고, 반려는 기다려도 열리지 않는다.
   * 한 문구로 합치면 반려된 학생이 오지 않을 승인을 기다린다.
   */
  it('신청 전·승인 대기·반려의 문구가 서로 다르다', () => {
    const notices = (['SUBMITTED', 'REJECTED', null] as const).map((status) => {
      const result = access('STUDENT', status);
      if (result.kind !== 'blocked') {
        throw new TypeError(`막혀야 하는 상태입니다: ${String(status)}`);
      }
      return result.notice;
    });

    expect(new Set(notices).size).toBe(3);
  });

  it('신청 전에는 신청 화면으로 가는 경로를 준다', () => {
    const result = access('STUDENT', null);
    if (result.kind !== 'blocked') throw new TypeError('막혀야 합니다.');

    expect(result.reason).toBe('NOT_APPLIED');
    expect(result.notice).toBe('이 프로그램에 신청해야 제출할 수 있습니다.');
    expect(result.buttonNote).toBe('신청 후 제출할 수 있습니다');
    // 프로그램 id에 `:`가 들어가므로 인코딩된 경로여야 Next 동적 구간이 온전히 남는다.
    expect(result.nextStep).toEqual({
      label: '신청하기',
      href: '/programs/program%3A1/apply',
    });
  });

  it('승인 대기에는 기다리라고만 하고 경로를 주지 않는다', () => {
    const result = access('STUDENT', 'SUBMITTED');
    if (result.kind !== 'blocked') throw new TypeError('막혀야 합니다.');

    expect(result.reason).toBe('AWAITING_DECISION');
    expect(result.notice).toBe(
      '신청 승인을 기다리는 중입니다. 승인되면 제출할 수 있습니다.',
    );
    expect(result.buttonNote).toBe('승인 후 제출할 수 있습니다');
    expect(result.nextStep).toBeNull();
  });

  /**
   * 반려에 「기다리세요」라고 적으면 학생은 오지 않을 승인을 기다린다 — 판정은 이미
   * 끝났고, 다음 할 일은 기다림이 아니라 사유를 읽는 것이다.
   */
  it('반려에는 기다리라고 하지 않고 사유를 읽게 한다', () => {
    const result = access('STUDENT', 'REJECTED');
    if (result.kind !== 'blocked') throw new TypeError('막혀야 합니다.');

    expect(result.reason).toBe('REJECTED');
    expect(result.notice).toBe(
      '신청이 반려되어 제출할 수 없습니다. 반려 사유를 확인해 주세요.',
    );
    expect(result.buttonNote).toBe('반려되어 제출할 수 없습니다');
    expect(result.notice).not.toContain('기다');
    expect(result.nextStep).toBeNull();
  });
});
