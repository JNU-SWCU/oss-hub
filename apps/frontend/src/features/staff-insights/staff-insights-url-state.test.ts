import { describe, expect, it } from 'vitest';
import {
  parseStaffInsightsSearchParams,
  buildStaffInsightsSearchParams,
} from './staff-insights-url-state';

describe('StaffInsights URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad',
    );
    expect(parseStaffInsightsSearchParams(input)).toEqual({ kind: 'all' });
  });

  it('omits defaults from the address', () => {
    expect(buildStaffInsightsSearchParams({ kind: 'all' }).toString()).toBe('');
  });

  it('round trips nondefault shareable state', () => {
    const input = { kind: 'calendar', year: 2025 } as const;
    const params = buildStaffInsightsSearchParams(input);
    expect(params.toString()).toBe('year=2025');
    expect(parseStaffInsightsSearchParams(params)).toEqual(input);
  });
});
