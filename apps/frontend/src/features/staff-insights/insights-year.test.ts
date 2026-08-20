import { describe, expect, it } from 'vitest';
import {
  insightsPageHref,
  insightsRequestPath,
  parseInsightsYearSearchParam,
} from './insights-year';

describe('parseInsightsYearSearchParam', () => {
  it('defaults a missing year to all-time', () => {
    expect(parseInsightsYearSearchParam(null)).toEqual({ kind: 'all' });
    expect(parseInsightsYearSearchParam(undefined)).toEqual({ kind: 'all' });
    expect(parseInsightsYearSearchParam('')).toEqual({ kind: 'all' });
    expect(parseInsightsYearSearchParam('all')).toEqual({ kind: 'all' });
  });

  it('keeps a calendar year as a number, not a mixed string', () => {
    expect(parseInsightsYearSearchParam('2026')).toEqual({
      kind: 'calendar',
      year: 2026,
    });
  });

  it('falls back to all-time for mixed query junk', () => {
    expect(parseInsightsYearSearchParam('2026;drop')).toEqual({ kind: 'all' });
  });
});

describe('insights hrefs', () => {
  it('omits year from the all-time URL so the server default stays all', () => {
    expect(insightsPageHref({ kind: 'all' })).toBe('/dashboard/insights');
    expect(insightsRequestPath({ kind: 'all' })).toBe(
      'dashboard/staff/insights',
    );
  });

  it('sends only a numeric year when a calendar year is selected', () => {
    expect(insightsPageHref({ kind: 'calendar', year: 2026 })).toBe(
      '/dashboard/insights?year=2026',
    );
    expect(insightsRequestPath({ kind: 'calendar', year: 2026 })).toBe(
      'dashboard/staff/insights?year=2026',
    );
  });
});
