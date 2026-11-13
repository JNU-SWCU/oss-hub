import { describe, expect, it } from 'vitest';
import { formatLastSuccess } from './format-relative-time';

describe('formatLastSuccess', () => {
  it.each([null, undefined])(
    '값이 %s이면 수집 기록 없음으로 표시한다',
    (value) => {
      expect(formatLastSuccess(value)).toBe('아직 성공한 수집 없음');
    },
  );
});
