import { DEPARTMENT_GROUPS } from './departments';

export const DEPARTMENT_COHORTS = {
  SW_MAJOR: 'sw-major',
  NON_SW: 'non-sw',
  UNREGISTERED: 'unregistered',
} as const;

export type DepartmentCohort =
  (typeof DEPARTMENT_COHORTS)[keyof typeof DEPARTMENT_COHORTS];

const SW_DEPARTMENT_GROUP = DEPARTMENT_GROUPS.find(
  (group) => group.label === 'SW학과',
);

if (SW_DEPARTMENT_GROUP === undefined) {
  throw new Error('SW학과 department group is missing');
}

export const SW_MAJOR_DEPARTMENTS: readonly string[] =
  SW_DEPARTMENT_GROUP.departments;

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
