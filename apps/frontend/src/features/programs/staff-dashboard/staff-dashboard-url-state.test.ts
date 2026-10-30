import { describe, expect, it } from 'vitest';
import {
  parseStaffDashboardSearchParams,
  buildStaffDashboardSearchParams,
} from './staff-dashboard-url-state';

describe('StaffDashboard URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad',
    );
    expect(parseStaffDashboardSearchParams(input)).toEqual({
      search: '',
      status: 'all',
      page: 1,
    });
  });

  it('omits defaults from the address', () => {
    expect(
      buildStaffDashboardSearchParams({
        search: '',
        status: 'all',
        page: 1,
      }).toString(),
    ).toBe('');
  });

  it('round trips nondefault shareable state', () => {
    const input = { search: 'x y', status: 'ended', page: 2 } as const;
    const params = buildStaffDashboardSearchParams(input);
    expect(params.toString()).toBe('search=x+y&status=ended&page=2');
    expect(parseStaffDashboardSearchParams(params)).toEqual(input);
  });
});
