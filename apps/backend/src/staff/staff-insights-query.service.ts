import { Injectable, BadRequestException } from '@nestjs/common';
import {
  INSIGHTS_YEAR_ERROR,
  type StaffInsightsFinderInput,
  type StaffInsightsFinderQuery,
} from './staff-insights-query.config';

@Injectable()
export class StaffInsightsQueryService {
  classifyDepartment(department: string | null): DepartmentCohort {
    if (department === null || department.trim() === '') {
      return DEPARTMENT_COHORTS.UNREGISTERED;
    }
    return SW_MAJOR_DEPARTMENT_SET.has(department)
      ? DEPARTMENT_COHORTS.SW_MAJOR
      : DEPARTMENT_COHORTS.NON_SW;
  }

  parseInsightsYearQuery(raw: string | undefined): InsightsYearScope {
    if (raw === undefined || raw === '') {
      return { kind: 'all' };
    }
    if (raw.toLowerCase() === 'all') {
      return { kind: 'all' };
    }
    if (!CALENDAR_YEAR_PATTERN.test(raw)) {
      throw new BadRequestException(INSIGHTS_YEAR_ERROR);
    }

    return { kind: 'calendar', year: Number(raw) };
  }

  rankingYearFilter(
    scope: InsightsYearScope,
  ): { readonly currentYear: number } | Record<string, never> {
    if (scope.kind === 'all') {
      return {};
    }
    return { currentYear: scope.year };
  }

  finderQuery(request: StaffInsightsFinderInput): StaffInsightsFinderQuery {
    return {
      ...this.rankingYearFilter(this.parseInsightsYearQuery(request.year)),
      search: request.search?.trim() ?? '',
      department: request.department,
      programId: request.programId,
      minActivity: request.minActivity ?? 0,
      recentActivity: request.recentActivity ?? 'all',
      sort: request.sort ?? 'total',
      direction: request.direction ?? 'desc',
      page: request.page ?? 1,
    };
  }
}

export const SW_MAJOR_DEPARTMENTS: readonly string[] = [
  '인공지능학부',
  '소프트웨어공학과',
  '컴퓨터정보통신공학과',
  '전자컴퓨터공학부(컴퓨터공학전공)',
];

const SW_MAJOR_DEPARTMENT_SET = new Set(SW_MAJOR_DEPARTMENTS);

const CALENDAR_YEAR_PATTERN = /^(20\d{2}|2100)$/;

export const DEPARTMENT_COHORTS = {
  SW_MAJOR: 'sw-major',
  NON_SW: 'non-sw',
  UNREGISTERED: 'unregistered',
} as const;

export type DepartmentCohort =
  (typeof DEPARTMENT_COHORTS)[keyof typeof DEPARTMENT_COHORTS];

export type InsightsYearScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'calendar'; readonly year: number };
