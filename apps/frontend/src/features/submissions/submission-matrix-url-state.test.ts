import { describe, expect, it } from 'vitest';
import {
  parseSubmissionMatrixSearchParams,
  buildSubmissionMatrixSearchParams,
} from './submission-matrix-url-state';

describe('SubmissionMatrix URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad',
    );
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

  it('round trips nondefault shareable state', () => {
    const input = {
      q: 'x y',
      page: 2,
      pageSize: 20,
      quickFilter: 'MISSING',
    } as const;
    const params = buildSubmissionMatrixSearchParams(input);
    expect(params.toString()).toBe('q=x+y&page=2&quickFilter=MISSING');
    expect(parseSubmissionMatrixSearchParams(params)).toEqual(input);
  });
});
