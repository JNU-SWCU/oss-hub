import { describe, expect, it } from 'vitest';
import { requireSubmissionUploadLimit } from './submission-upload-policy';

describe('업로드 제한 응답', () => {
  it('서버에서 받은 바이트와 표시 문구를 유지한다', () => {
    expect(
      requireSubmissionUploadLimit({ maxBytes: 2_000_000, maxLabel: '2 MB' }),
    ).toEqual({ maxBytes: 2_000_000, maxLabel: '2 MB' });
  });

  it.each([
    undefined,
    null,
    {},
    { maxBytes: 0, maxLabel: '0 MB' },
    { maxBytes: Infinity, maxLabel: '무제한' },
    { maxBytes: 2_000_000, maxLabel: '' },
  ])('제한이 없거나 잘못된 응답 %j는 숫자로 대체하지 않는다', (value) => {
    expect(() => requireSubmissionUploadLimit(value)).toThrow(TypeError);
  });
});
