import { BadRequestException } from '@nestjs/common';
import {
  parseInsightsYearQuery,
  rankingYearFilter,
} from './staff-insights-year';

describe('parseInsightsYearQuery', () => {
  it('defaults a missing or blank year to all-time', () => {
    expect(parseInsightsYearQuery(undefined)).toEqual({ kind: 'all' });
    expect(parseInsightsYearQuery('')).toEqual({ kind: 'all' });
    expect(parseInsightsYearQuery('all')).toEqual({ kind: 'all' });
    expect(parseInsightsYearQuery('ALL')).toEqual({ kind: 'all' });
  });

  it('accepts a calendar year as an integer scope', () => {
    expect(parseInsightsYearQuery('2026')).toEqual({
      kind: 'calendar',
      year: 2026,
    });
  });

  it('rejects mixed strings so they never reach a query', () => {
    expect(() => parseInsightsYearQuery('2026; drop table users')).toThrow(
      BadRequestException,
    );
    expect(() => parseInsightsYearQuery('20all')).toThrow(BadRequestException);
    expect(() => parseInsightsYearQuery('1999')).toThrow(BadRequestException);
  });
});

describe('rankingYearFilter', () => {
  it('omits currentYear for all-time so SQL never sees the all token', () => {
    expect(rankingYearFilter({ kind: 'all' })).toEqual({});
  });

  it('passes only a number for a calendar year', () => {
    expect(rankingYearFilter({ kind: 'calendar', year: 2026 })).toEqual({
      currentYear: 2026,
    });
  });
});
