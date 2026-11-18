import { describe, expect, it } from 'vitest';
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
      year: 'all',
      page: 1,
    });
  });

  it.each([
    ['', 'all', 1, ''],
    ['year=', 'all', 1, ''],
    ['year=ALL&page=2', 'all', 2, 'page=2'],
    ['year=2026', 2026, 1, 'year=2026'],
    ['year=2025&page=2', 2025, 2, 'year=2025&page=2'],
  ] as const)(
    'parses and serializes ranking query %s',
    (query, year, page, canonical) => {
      const state = parseRankingSearchParams(new URLSearchParams(query));
      expect(state).toEqual({ year, page });
      expect(buildRankingSearchParams(state).toString()).toBe(canonical);
    },
  );
});
