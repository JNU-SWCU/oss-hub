import type { StaffInsightsSummary } from './types';
import { DEPARTMENT_COHORTS } from './types';

export const STAFF_INSIGHTS_FIXTURE: StaffInsightsSummary = {
  scope: { kind: 'all' },
  dataAsOf: new Date('2026-08-01T00:00:00.000Z'),
  years: [2026, 2025],
  cohorts: [
    {
      cohort: DEPARTMENT_COHORTS.SW_MAJOR,
      studentCount: 42,
      activeStudentCount: 31,
      commitCount: 480,
      pullRequestCount: 96,
      issueCount: 18,
      repositoryCount: 24,
      starCount: 80,
      total: 698,
      participantCount: 28,
    },
    {
      cohort: DEPARTMENT_COHORTS.NON_SW,
      studentCount: 18,
      activeStudentCount: 9,
      commitCount: 70,
      pullRequestCount: 14,
      issueCount: 4,
      repositoryCount: 6,
      starCount: 10,
      total: 104,
      participantCount: 11,
    },
    {
      cohort: DEPARTMENT_COHORTS.UNREGISTERED,
      studentCount: 3,
      activeStudentCount: 0,
      commitCount: 0,
      pullRequestCount: 0,
      issueCount: 0,
      repositoryCount: 0,
      starCount: 0,
      total: 0,
      participantCount: 1,
    },
  ],
  departments: [
    {
      department: '소프트웨어공학과',
      cohort: DEPARTMENT_COHORTS.SW_MAJOR,
      studentCount: 20,
      activeStudentCount: 16,
      commitCount: 260,
      pullRequestCount: 50,
      issueCount: 7,
      repositoryCount: 12,
      starCount: 40,
      total: 369,
      participantCount: 14,
    },
    {
      department: '인공지능학부',
      cohort: DEPARTMENT_COHORTS.SW_MAJOR,
      studentCount: 14,
      activeStudentCount: 10,
      commitCount: 150,
      pullRequestCount: 30,
      issueCount: 4,
      repositoryCount: 8,
      starCount: 25,
      total: 217,
      participantCount: 9,
    },
    {
      department: '컴퓨터정보통신공학과',
      cohort: DEPARTMENT_COHORTS.SW_MAJOR,
      studentCount: 6,
      activeStudentCount: 4,
      commitCount: 50,
      pullRequestCount: 12,
      issueCount: 4,
      repositoryCount: 3,
      starCount: 8,
      total: 77,
      participantCount: 4,
    },
    {
      department: '전자컴퓨터공학부(컴퓨터공학전공)',
      cohort: DEPARTMENT_COHORTS.SW_MAJOR,
      studentCount: 2,
      activeStudentCount: 1,
      commitCount: 20,
      pullRequestCount: 4,
      issueCount: 3,
      repositoryCount: 1,
      starCount: 7,
      total: 35,
      participantCount: 1,
    },
    {
      department: '빅데이터융합학과',
      cohort: DEPARTMENT_COHORTS.NON_SW,
      studentCount: 10,
      activeStudentCount: 6,
      commitCount: 40,
      pullRequestCount: 8,
      issueCount: 2,
      repositoryCount: 3,
      starCount: 6,
      total: 59,
      participantCount: 7,
    },
    {
      department: '문헌정보학과(문헌정보SW트랙)',
      cohort: DEPARTMENT_COHORTS.NON_SW,
      studentCount: 8,
      activeStudentCount: 3,
      commitCount: 30,
      pullRequestCount: 6,
      issueCount: 2,
      repositoryCount: 3,
      starCount: 4,
      total: 45,
      participantCount: 4,
    },
    {
      department: '미등록',
      cohort: DEPARTMENT_COHORTS.UNREGISTERED,
      studentCount: 3,
      activeStudentCount: 0,
      commitCount: 0,
      pullRequestCount: 0,
      issueCount: 0,
      repositoryCount: 0,
      starCount: 0,
      total: 0,
      participantCount: 1,
    },
  ],
  programs: [
    {
      programId: 'program-basic-study',
      name: '합성 기초 오픈소스 스터디',
      swMajorCount: 16,
      nonSwCount: 7,
      unregisteredCount: 1,
      participantCount: 24,
    },
    {
      programId: 'program-capstone',
      name: '합성 캡스톤 2026',
      swMajorCount: 12,
      nonSwCount: 4,
      unregisteredCount: 0,
      participantCount: 16,
    },
  ],
};

export function staffInsightsWireFixture(
  variant: 'default' | 'long' | 'zero' | 'empty' | 'unregistered' = 'default',
): Record<string, unknown> {
  const summary =
    variant === 'long'
      ? {
          ...STAFF_INSIGHTS_FIXTURE,
          programs: STAFF_INSIGHTS_FIXTURE.programs.map((program) => ({
            ...program,
            name: '2026학년도 전공·비전공 협업을 위한 아주 긴 한국어 프로그램 레이블 테스트',
          })),
        }
      : variant === 'zero'
        ? {
            ...STAFF_INSIGHTS_FIXTURE,
            cohorts: STAFF_INSIGHTS_FIXTURE.cohorts.map((row) => ({
              ...row,
              studentCount: 0,
              activeStudentCount: 0,
              participantCount: 0,
            })),
            programs: [],
          }
        : variant === 'empty'
          ? {
              ...STAFF_INSIGHTS_FIXTURE,
              cohorts: [],
              departments: [],
              programs: [],
            }
          : variant === 'unregistered'
            ? {
                ...STAFF_INSIGHTS_FIXTURE,
                cohorts: [STAFF_INSIGHTS_FIXTURE.cohorts[2]],
                departments: [STAFF_INSIGHTS_FIXTURE.departments[6]],
                programs: [
                  {
                    ...STAFF_INSIGHTS_FIXTURE.programs[0],
                    swMajorCount: 0,
                    nonSwCount: 0,
                    unregisteredCount: 2,
                    participantCount: 2,
                  },
                ],
              }
            : STAFF_INSIGHTS_FIXTURE;
  return {
    scope: summary.scope,
    dataAsOf: summary.dataAsOf?.toISOString() ?? null,
    years: summary.years,
    cohorts: summary.cohorts,
    departments: summary.departments,
    programs: summary.programs,
  };
}

export function staffInsightsWireFixtureLegacy(): Record<string, unknown> {
  return {
    scope: { kind: 'all' },
    dataAsOf: '2026-08-01T00:00:00.000Z',
    years: [2026, 2025],
    cohorts: STAFF_INSIGHTS_FIXTURE.cohorts,
    departments: STAFF_INSIGHTS_FIXTURE.departments,
    programs: STAFF_INSIGHTS_FIXTURE.programs,
  };
}
