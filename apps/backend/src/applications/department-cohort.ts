export const DEPARTMENT_COHORTS = {
  SW_MAJOR: 'sw-major',
  NON_SW: 'non-sw',
  UNREGISTERED: 'unregistered',
} as const;

export type DepartmentCohort =
  (typeof DEPARTMENT_COHORTS)[keyof typeof DEPARTMENT_COHORTS];

/**
 * Signup picker SW학과 group. Keep in lockstep with
 * `apps/frontend/src/lib/departments.ts`.
 */
export const SW_MAJOR_DEPARTMENTS: readonly string[] = [
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
