import { describe, expect, it } from 'vitest';
import { OTHER_DEPARTMENT } from './departments';
import {
  createInitialProfileForm,
  getProfileRedirect,
  isProfileFormValid,
  PROFILE_ONBOARDING_NEXT_PATH,
  resolveDepartment,
  toCompleteProfileRequest,
  validateProfileForm,
} from './profile-state';
import type { ProfileFormValues } from './types';

function validValues(
  overrides: Partial<ProfileFormValues> = {},
): ProfileFormValues {
  return {
    name: '합성 사용자',
    studentId: '1'.repeat(6),
    departmentOption: '인공지능학부',
    otherDepartment: '',
    ...overrides,
  };
}

describe('profile onboarding state', () => {
  it.each([
    ['5자리', '1'.repeat(5), false],
    ['6자리', '1'.repeat(6), true],
    ['10자리', '1'.repeat(10), true],
    ['11자리', '1'.repeat(11), false],
    ['문자 포함', `${'1'.repeat(5)}A`, false],
  ])('%s 학번을 계약대로 검증한다', (_name, studentId, valid) => {
    const errors = validateProfileForm(validValues({ studentId }));
    expect(errors.studentId === null).toBe(valid);
  });

  it('이름·학과가 비면 제출 요청을 만들지 않는다', () => {
    const values = validValues({ name: ' ', departmentOption: '' });
    const errors = validateProfileForm(values);

    expect(isProfileFormValid(errors)).toBe(false);
    expect(toCompleteProfileRequest(values)).toBeNull();
  });

  it('기타 학과는 직접 입력값을 정규화해 저장 요청에 사용한다', () => {
    const values = validValues({
      name: '  합성 사용자  ',
      departmentOption: OTHER_DEPARTMENT,
      otherDepartment: '  합성 융합전공  ',
    });

    expect(resolveDepartment(values)).toBe('합성 융합전공');
    expect(toCompleteProfileRequest(values)).toEqual({
      name: '합성 사용자',
      studentId: '1'.repeat(6),
      department: '합성 융합전공',
    });
  });

  it('목록 밖의 저장 학과는 기타 직접 입력으로 프리필한다', () => {
    expect(
      createInitialProfileForm({
        name: '합성 사용자',
        studentId: null,
        department: '합성 융합전공',
        isComplete: false,
      }),
    ).toMatchObject({
      departmentOption: OTHER_DEPARTMENT,
      otherDepartment: '합성 융합전공',
    });
  });

  it('이미 완료된 프로필만 역할 선택 경로로 건너뛴다', () => {
    expect(
      getProfileRedirect({
        name: '합성 사용자',
        studentId: '1'.repeat(6),
        department: '인공지능학부',
        isComplete: true,
      }),
    ).toBe(PROFILE_ONBOARDING_NEXT_PATH);
    expect(
      getProfileRedirect({
        name: 'GitHub 합성 이름',
        studentId: null,
        department: null,
        isComplete: false,
      }),
    ).toBeNull();
  });
});
