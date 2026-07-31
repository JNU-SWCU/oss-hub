import { describe, expect, it } from 'vitest';
import { OTHER_DEPARTMENT } from './departments';
import {
  createInitialProfileForm,
  getProfileRedirect,
  isProfileFormValid,
  PROFILE_ONBOARDING_NEXT_PATH,
  resolveDepartment,
  toCompleteProfileRequest,
  toUpdateProfileRequest,
  validateProfileForm,
  validateSettingsProfileForm,
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
    const errors = validateProfileForm(validValues({ studentId }), 'STUDENT');
    expect(errors.studentId === null).toBe(valid);
  });

  it('이름·학과가 비면 제출 요청을 만들지 않는다', () => {
    const values = validValues({ name: ' ', departmentOption: '' });
    const errors = validateProfileForm(values, 'STUDENT');

    expect(isProfileFormValid(errors)).toBe(false);
    expect(toCompleteProfileRequest(values, 'STUDENT')).toBeNull();
  });

  it('기타 학과는 직접 입력값을 정규화해 저장 요청에 사용한다', () => {
    const values = validValues({
      name: '  합성 사용자  ',
      departmentOption: OTHER_DEPARTMENT,
      otherDepartment: '  합성 융합전공  ',
    });

    expect(resolveDepartment(values)).toBe('합성 융합전공');
    expect(toCompleteProfileRequest(values, 'STUDENT')).toEqual({
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
      getProfileRedirect(
        {
          name: '합성 사용자',
          studentId: '1'.repeat(6),
          department: '인공지능학부',
          isComplete: true,
        },
        'STUDENT',
      ),
    ).toBe(PROFILE_ONBOARDING_NEXT_PATH);
    expect(
      getProfileRedirect(
        {
          name: 'GitHub 합성 이름',
          studentId: null,
          department: null,
          isComplete: false,
        },
        'STUDENT',
      ),
    ).toBeNull();
  });

  it('교직원 폼은 학번이 비어도 통과하고 요청에서 키가 빠진다', () => {
    const values = validValues({ studentId: '' });

    expect(validateProfileForm(values, 'STAFF').studentId).toBeNull();
    expect(toCompleteProfileRequest(values, 'STAFF')).toEqual({
      name: '합성 사용자',
      department: '인공지능학부',
    });
    expect(toCompleteProfileRequest(values, 'STAFF')).not.toHaveProperty(
      'studentId',
    );
  });

  it('교직원도 학과는 필수고, 남아 있는 학번 값은 형식을 지켜야 한다', () => {
    expect(
      validateProfileForm(validValues({ departmentOption: '' }), 'STAFF')
        .department,
    ).toBe('학과를 선택하거나 입력해 주세요.');
    expect(
      validateProfileForm(validValues({ studentId: '12A456' }), 'STAFF')
        .studentId,
    ).toBe('학번은 숫자 6~10자리로 입력해 주세요.');
  });

  it('관리자 폼은 학번·학과가 비어도 이름만으로 요청을 만든다', () => {
    const values = validValues({ studentId: '', departmentOption: '' });

    expect(validateProfileForm(values, 'ADMIN')).toEqual({
      name: null,
      studentId: null,
      department: null,
    });
    expect(toCompleteProfileRequest(values, 'ADMIN')).toEqual({
      name: '합성 사용자',
    });
    expect(toUpdateProfileRequest(values, 'ADMIN')).toEqual({
      name: '합성 사용자',
    });
  });

  it('역할이 요구하지 않아도 이미 있는 값은 요청에 그대로 실어 보낸다', () => {
    expect(toCompleteProfileRequest(validValues(), 'ADMIN')).toEqual({
      name: '합성 사용자',
      studentId: '1'.repeat(6),
      department: '인공지능학부',
    });
    expect(toUpdateProfileRequest(validValues(), 'ADMIN')).toEqual({
      name: '합성 사용자',
      department: '인공지능학부',
    });
  });

  it('설정용 프로필 갱신은 이름·학과만 검증하고 학번을 제외한다', () => {
    const values = validValues({ studentId: '' });
    expect(validateSettingsProfileForm(values, 'STUDENT')).toEqual({
      name: null,
      department: null,
    });
    expect(toUpdateProfileRequest(values, 'STUDENT')).toEqual({
      name: '합성 사용자',
      department: '인공지능학부',
    });
    expect(toUpdateProfileRequest(values, 'STUDENT')).not.toHaveProperty(
      'studentId',
    );
    expect(
      toUpdateProfileRequest(
        validValues({ name: ' ', departmentOption: '' }),
        'STUDENT',
      ),
    ).toBeNull();
  });
});
