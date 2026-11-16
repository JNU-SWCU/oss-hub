import { describe, expect, it } from 'vitest';
import {
  parseStaffInsightsSearchParams,
  buildStaffInsightsSearchParams,
} from './staff-insights-url-state';

describe('StaffInsights URL state', () => {
  it('falls back to defaults when values are invalid', () => {
    const input = new URLSearchParams(
      'page=abc&sort=bad&status=bad&filter=bad&year=bad&granularity=bad&from=bad&to=bad&action=bad&view=bad',
    );
    expect(parseStaffInsightsSearchParams(input)).toEqual({
      scope: { kind: 'all' },
      view: 'students',
    });
  });

  it('parses an unknown view as the students view', () => {
    expect(
      parseStaffInsightsSearchParams(new URLSearchParams('view=bogus')).view,
    ).toBe('students');
  });

  it('omits defaults, including the students view, from the address', () => {
    expect(
      buildStaffInsightsSearchParams({
        scope: { kind: 'all' },
        view: 'students',
      }).toString(),
    ).toBe('');
    expect(
      buildStaffInsightsSearchParams({
        scope: { kind: 'calendar', year: 2025 },
        view: 'students',
      }).toString(),
    ).toBe('year=2025');
  });

  it('round trips a nondefault view and year', () => {
    const parsed = parseStaffInsightsSearchParams(
      new URLSearchParams('view=groups&year=2026'),
    );
    expect(parsed).toEqual({
      scope: { kind: 'calendar', year: 2026 },
      view: 'groups',
    });
    const params = buildStaffInsightsSearchParams(parsed);
    expect(params.toString()).toBe('year=2026&view=groups');
    expect(parseStaffInsightsSearchParams(params)).toEqual(parsed);
  });
});
