import { describe, expect, it } from 'vitest';
import {
  parseStudentDashboardSearchParams,
  buildStudentDashboardSearchParams,
} from './student-dashboard-url-state';

describe('StudentDashboard URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad',
    );
    expect(parseStudentDashboardSearchParams(input)).toEqual({ status: 'all' });
  });

  it('omits defaults from the address', () => {
    expect(
      buildStudentDashboardSearchParams({ status: 'all' }).toString(),
    ).toBe('');
  });

  it('round trips nondefault shareable state', () => {
    const input = { status: 'done' } as const;
    const params = buildStudentDashboardSearchParams(input);
    expect(params.toString()).toBe('status=done');
    expect(parseStudentDashboardSearchParams(params)).toEqual(input);
  });
});
