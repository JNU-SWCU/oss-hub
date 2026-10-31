import { describe, expect, it } from 'vitest';
import {
  parseStaffTeamsSearchParams,
  buildStaffTeamsSearchParams,
} from './staff-teams-url-state';

describe('StaffTeams URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad',
    );
    expect(parseStaffTeamsSearchParams(input)).toEqual({
      search: '',
      filter: 'all',
      page: 1,
    });
  });

  it('omits defaults from the address', () => {
    expect(
      buildStaffTeamsSearchParams({
        search: '',
        filter: 'all',
        page: 1,
      }).toString(),
    ).toBe('');
  });

  it('round trips nondefault shareable state', () => {
    const input = { search: 'x y', filter: 'APPROVED', page: 2 } as const;
    const params = buildStaffTeamsSearchParams(input);
    expect(params.toString()).toBe('search=x+y&filter=APPROVED&page=2');
    expect(parseStaffTeamsSearchParams(params)).toEqual(input);
  });
});
