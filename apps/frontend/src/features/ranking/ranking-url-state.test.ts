import { describe, expect, it } from 'vitest';
import { currentRankingYear } from './types';
import {
  parseRankingSearchParams,
  buildRankingSearchParams,
} from './ranking-url-state';

describe('Ranking URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad',
    );
    expect(parseRankingSearchParams(input)).toEqual({
      year: currentRankingYear(),
      page: 1,
    });
  });

  it('omits defaults from the address', () => {
    expect(
      buildRankingSearchParams({
        year: currentRankingYear(),
        page: 1,
      }).toString(),
    ).toBe('');
  });

  it('round trips nondefault shareable state', () => {
    const input = { year: 'all', page: 2 } as const;
    const params = buildRankingSearchParams(input);
    expect(params.toString()).toBe('year=all&page=2');
    expect(parseRankingSearchParams(params)).toEqual(input);
  });
});
