import { BadRequestException } from '@nestjs/common';
import {
  classifyDepartment,
  DEPARTMENT_COHORTS,
  parseInsightsYearQuery,
  rankingYearFilter,
} from './staff-insights.service';

describe('department-cohort', () => {
  describe('classifyDepartment', () => {
    it('treats the SW학과 picker list as SW majors', () => {
      expect(classifyDepartment('인공지능학부')).toBe(
        DEPARTMENT_COHORTS.SW_MAJOR,
      );
      expect(classifyDepartment('소프트웨어공학과')).toBe(
        DEPARTMENT_COHORTS.SW_MAJOR,
      );
      expect(classifyDepartment('컴퓨터정보통신공학과')).toBe(
        DEPARTMENT_COHORTS.SW_MAJOR,
      );
      expect(classifyDepartment('전자컴퓨터공학부(컴퓨터공학전공)')).toBe(
        DEPARTMENT_COHORTS.SW_MAJOR,
      );
    });

    it('classifies fusion, tracks, and other free text as non-SW', () => {
      expect(classifyDepartment('빅데이터융합학과')).toBe(
        DEPARTMENT_COHORTS.NON_SW,
      );
      expect(classifyDepartment('전자컴퓨터공학부')).toBe(
        DEPARTMENT_COHORTS.NON_SW,
      );
    });

    it('keeps empty department out of the non-SW bucket', () => {
      expect(classifyDepartment(null)).toBe(DEPARTMENT_COHORTS.UNREGISTERED);
      expect(classifyDepartment('')).toBe(DEPARTMENT_COHORTS.UNREGISTERED);
    });
  });
});

describe('staff-insights-year', () => {
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
      expect(() => parseInsightsYearQuery('20all')).toThrow(
        BadRequestException,
      );
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
});
