import { BadRequestException } from '@nestjs/common';

export const INSIGHTS_YEAR_MIN = 2000;
export const INSIGHTS_YEAR_MAX = 2100;

export type InsightsYearScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'calendar'; readonly year: number };

const CALENDAR_YEAR_PATTERN = /^(20\d{2}|2100)$/;

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
