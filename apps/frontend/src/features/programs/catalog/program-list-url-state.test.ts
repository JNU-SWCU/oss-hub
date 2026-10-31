import { describe, expect, it } from 'vitest';
import {
  parseProgramListSearchParams,
  buildProgramListSearchParams,
} from './program-list-url-state';

describe('ProgramList URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad',
    );
    expect(parseProgramListSearchParams(input)).toEqual({
      status: 'all',
      search: '',
      page: 1,
      sort: undefined,
      direction: undefined,
      year: undefined,
    });
  });

  it('omits defaults from the address', () => {
    expect(
      buildProgramListSearchParams({
        status: 'all',
        search: '',
        page: 1,
        sort: undefined,
        direction: undefined,
        year: undefined,
      }).toString(),
    ).toBe('');
  });

  it('round trips nondefault shareable state', () => {
    const input = {
      status: 'ended',
      search: 'x y',
      page: 2,
      sort: 'name',
      direction: 'desc',
      year: 2025,
    } as const;
    const params = buildProgramListSearchParams(input);
    expect(params.toString()).toBe(
      'status=ended&year=2025&sort=name&direction=desc&search=x+y&page=2',
    );
    expect(parseProgramListSearchParams(params)).toEqual(input);
  });
});
