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
  it('승인된 학생에게는 문을 열어 둔다', () => {
    expect(access('STUDENT', 'APPROVED')).toEqual({ kind: 'open' });
  });

  it('학생이 아닌 사람은 이 문의 대상이 아니다', () => {
    for (const role of ['STAFF', 'ADMIN', 'PENDING', null] as const) {
      expect(access(role)).toEqual({ kind: 'open' });
    }
  });

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

  it('반려는 이 화면이 답을 정하지 않은 상태로 둔다', () => {
    expect(access('STUDENT', 'REJECTED')).toEqual({ kind: 'unchanged' });
  });
});
