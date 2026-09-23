import { describe, expect, it } from 'vitest';

import {
  ACCESS_STATE_LABEL,
  ACCOUNT_STATUS_LABEL,
  ROLE_LABEL,
  SUBMISSION_STATUS_BADGE,
  SUBMISSION_STATUS_LABELS,
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

  it('역할이 없으면 미지정을 실패 색이 아닌 중립 색으로 그린다', () => {
    expect(roleLabel(null)).toBe('미지정');
    expect(roleBadgeVariant(null)).toBe('closed');
    expect(roleBadgeVariant('ADMIN')).toBe('approved');
  });
});
