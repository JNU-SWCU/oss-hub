import { describe, expect, it } from 'vitest';

import {
  ACCESS_STATE_LABEL,
  ACCOUNT_STATUS_LABEL,
  ROLE_LABEL,
  SUBMISSION_DISPLAY_BADGE,
  SUBMISSION_STATUS_BADGE,
  SUBMISSION_STATUS_LABELS,
  submissionStatusLabel,
  roleBadgeVariant,
  roleLabel,
} from './index';

describe('status vocabulary', () => {
  it('한 도메인 안에서 두 상태가 같은 말을 쓰지 않는다', () => {
    for (const labels of [
      SUBMISSION_STATUS_LABELS,
      ROLE_LABEL,
      ACCOUNT_STATUS_LABEL,
      ACCESS_STATE_LABEL,
    ]) {
      const values = Object.values(labels);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('제출 상태의 붉은 배지는 반려 하나다', () => {
    const red = Object.entries(SUBMISSION_STATUS_BADGE)
      .filter(([, variant]) => variant === 'rejected')
      .map(([key]) => key);
    expect(red).toEqual(['REJECTED']);
  });

  it('학생과 교직원은 보완 요청 문구만 다르게 읽는다', () => {
    expect(submissionStatusLabel('CHANGES_REQUESTED', 'student')).toBe(
      '보완 필요',
    );
    expect(submissionStatusLabel('CHANGES_REQUESTED', 'staff')).toBe(
      '보완 요청 중',
    );
    for (const audience of ['student', 'staff'] as const) {
      expect(submissionStatusLabel('OVERDUE', audience)).toBe('기한 지남');
      expect(submissionStatusLabel('NOT_SUBMITTED', audience)).toBe('미제출');
      expect(submissionStatusLabel('SUBMITTED', audience)).toBe('검토 대기');
      expect(submissionStatusLabel('APPROVED', audience)).toBe('승인');
      expect(submissionStatusLabel('REJECTED', audience)).toBe('반려');
    }
    expect(SUBMISSION_STATUS_LABELS.CHANGES_REQUESTED).toBe('보완 요청');
  });

  it('기한 지남은 붉은 배지로 그린다', () => {
    expect(SUBMISSION_DISPLAY_BADGE.OVERDUE).toBe('rejected');
  });

  it('역할이 없으면 미지정을 실패 색이 아닌 중립 색으로 그린다', () => {
    expect(roleLabel(null)).toBe('미지정');
    expect(roleBadgeVariant(null)).toBe('closed');
    expect(roleBadgeVariant('ADMIN')).toBe('approved');
  });
});
