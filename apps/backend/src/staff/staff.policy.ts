import { BadRequestException } from '@nestjs/common';

export const DEPARTMENT_COHORTS = {
  SW_MAJOR: 'sw-major',
  NON_SW: 'non-sw',
  UNREGISTERED: 'unregistered',
} as const;

export type DepartmentCohort =
  (typeof DEPARTMENT_COHORTS)[keyof typeof DEPARTMENT_COHORTS];

const SW_MAJOR_DEPARTMENTS: readonly string[] = [
  '인공지능학부',
  '소프트웨어공학과',
  '컴퓨터정보통신공학과',
  '전자컴퓨터공학부(컴퓨터공학전공)',
];

const SW_MAJOR_DEPARTMENT_SET = new Set(SW_MAJOR_DEPARTMENTS);

export function classifyDepartment(
  department: string | null,
): DepartmentCohort {
  if (department === null || department.trim() === '') {
    return DEPARTMENT_COHORTS.UNREGISTERED;
  }
  return SW_MAJOR_DEPARTMENT_SET.has(department)
    ? DEPARTMENT_COHORTS.SW_MAJOR
    : DEPARTMENT_COHORTS.NON_SW;
}

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
