import { describe, expect, it } from 'vitest';
import {
  parseBoardListSearchParams,
  buildBoardListSearchParams,
} from './board-list-url-state';

describe('BoardList URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad',
    );
    expect(parseBoardListSearchParams(input)).toEqual({ page: 1 });
  });

  it('omits defaults from the address', () => {
    expect(buildBoardListSearchParams({ page: 1 }).toString()).toBe('');
  });

  it('round trips nondefault shareable state', () => {
    const input = { page: 2 } as const;
    const params = buildBoardListSearchParams(input);
    expect(params.toString()).toBe('page=2');
    expect(parseBoardListSearchParams(params)).toEqual(input);
  });
});
