import { BadRequestException } from '@nestjs/common';

export const INSIGHTS_YEAR_MIN = 2000;
export const INSIGHTS_YEAR_MAX = 2100;

/**
 * Calendar year or all-time (ADR-011).
 * Never a query string — callers pass this discriminated union so `all`
 * cannot be interpolated into SQL.
 */
export type InsightsYearScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'calendar'; readonly year: number };

const CALENDAR_YEAR_PATTERN = /^(20\d{2}|2100)$/;

/**
 * Missing/blank `?year=` is all-time. `all` is explicit all-time.
 * Only a 4-digit calendar year becomes `{ kind: 'calendar' }`.
 */
export function parseInsightsYearQuery(
  raw: string | undefined,
): InsightsYearScope {
  if (raw === undefined || raw === '') {
    return { kind: 'all' };
  }
  if (raw.toLowerCase() === 'all') {
    return { kind: 'all' };
  }
  if (!CALENDAR_YEAR_PATTERN.test(raw)) {
    throw new BadRequestException(
      `year must be omitted, "all", or a calendar year between ${INSIGHTS_YEAR_MIN} and ${INSIGHTS_YEAR_MAX}`,
    );
  }
  // The regex is the range source (2000–2099 ∪ {2100}). MIN/MAX are message constants.
  return { kind: 'calendar', year: Number(raw) };
}

export function rankingYearFilter(
  scope: InsightsYearScope,
): { readonly currentYear: number } | Record<string, never> {
  if (scope.kind === 'all') {
    return {};
  }
  return { currentYear: scope.year };
}
