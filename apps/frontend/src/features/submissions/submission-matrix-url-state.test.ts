import { describe, expect, it } from 'vitest';
import {
  parseSubmissionMatrixSearchParams,
  buildSubmissionMatrixSearchParams,
} from './submission-matrix-url-state';

describe('SubmissionMatrix URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams('page=abc&quickFilter=bad');
    expect(parseSubmissionMatrixSearchParams(input)).toEqual({
      q: '',
      page: 1,
      pageSize: 20,
      quickFilter: 'ALL',
    });
  });

  it('omits defaults from the address', () => {
    expect(
      buildSubmissionMatrixSearchParams({
        q: '',
        page: 1,
        pageSize: 20,
        quickFilter: 'ALL',
      }).toString(),
    ).toBe('');
  });

  it.each([
    'OVERDUE',
    'NOT_SUBMITTED',
    'SUBMITTED',
    'CHANGES_REQUESTED',
    'APPROVED',
    'REJECTED',
  ] as const)('round trips the shareable %s action filter', (quickFilter) => {
    const input = {
      q: 'x y',
      page: 2,
      pageSize: 20,
      quickFilter,
    } as const;
    const params = buildSubmissionMatrixSearchParams(input);
    expect(params.toString()).toBe(`q=x+y&page=2&quickFilter=${quickFilter}`);
    expect(parseSubmissionMatrixSearchParams(params)).toEqual(input);
  });

  it.each(['MISSING', 'LATE', 'COMPLETE', 'NO_REQUIRED_ITEMS'])(
    'opens the legacy quickFilter=%s bookmark unfiltered',
    (legacy) => {
      expect(
        parseSubmissionMatrixSearchParams(
          new URLSearchParams(`quickFilter=${legacy}`),
        ).quickFilter,
      ).toBe('ALL');
    },
  );
});
