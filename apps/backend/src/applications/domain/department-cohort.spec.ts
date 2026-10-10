import { classifyDepartment, DEPARTMENT_COHORTS } from './department-cohort';

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
