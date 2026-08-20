import { describe, expect, it } from 'vitest';
import { OTHER_DEPARTMENT } from './departments';
import {
  createInitialProfileForm,
  getProfileRedirect,
  isProfileFormValid,
  resolveDepartment,
  toCompleteProfileRequest,
  toUpdateProfileRequest,
  validateProfileForm,
  validateSettingsProfileForm,
} from './profile-state';
import type { SettingsProfileFields } from './profile-state';
import type { ProfileFormValues } from './types';

function validValues(
  overrides: Partial<ProfileFormValues> = {},
): ProfileFormValues {
  return {
    name: '합성 사용자',
    studentId: '1'.repeat(6),
    // 기본은 아직 학번이 저장되지 않은 상태 — 새로 입력하는 값이라 형식을 본다.
    savedStudentId: '',
    departmentOption: '인공지능학부',
    otherDepartment: '',
    ...overrides,
  };
}

/** 설정 화면 값 — 기본은 학번이 이미 저장돼 있는(=수정 불가) 상태다. */
function settingsValues(
  overrides: Partial<SettingsProfileFields> = {},
): SettingsProfileFields {
  return {
    ...validValues(),
    savedStudentId: '1'.repeat(6),
    ...overrides,
  };
}

describe('profile onboarding state', () => {
  it.each([
    ['5자리', '1'.repeat(5), false],
    ['6자리', '1'.repeat(6), true],
    ['7자리', '1'.repeat(7), false],
    ['10자리', '1'.repeat(10), false],
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

  it('이미 완료된 프로필만 다음 단계로 건너뛴다', () => {
    // 프로필이 온보딩의 마지막 단계라 목적지가 역할마다 다르다 — app 계층이 넘긴
    // 경로를 그대로 쓴다.
    const nextPath = '/programs';
    expect(
      getProfileRedirect(
        {
          name: '합성 사용자',
          studentId: '1'.repeat(6),
          department: '인공지능학부',
          isComplete: true,
        },
        'STUDENT',
        nextPath,
      ),
    ).toBe(nextPath);
    expect(
      getProfileRedirect(
        {
          name: 'GitHub 합성 이름',
          studentId: null,
          department: null,
          isComplete: false,
        },
        'STUDENT',
        nextPath,
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

  it('교직원은 학번은 필요 없어도 학과는 필수다', () => {
    expect(
      validateProfileForm(validValues({ departmentOption: '' }), 'STAFF')
        .department,
    ).toBe('학과를 선택하거나 입력해 주세요.');
  });

  it('관리자 폼도 학과가 비면 요청을 만들지 않는다', () => {
    const values = validValues({ studentId: '', departmentOption: '' });

    expect(validateProfileForm(values, 'ADMIN')).toEqual({
      name: null,
      studentId: null,
      department: '학과를 선택하거나 입력해 주세요.',
    });
    expect(toCompleteProfileRequest(values, 'ADMIN')).toBeNull();
    expect(
      toUpdateProfileRequest(
        settingsValues({ ...values, savedStudentId: '' }),
        'ADMIN',
      ),
    ).toBeNull();
  });

  it('역할이 요구하지 않아도 이미 있는 값은 완료 요청에 그대로 실어 보낸다', () => {
    expect(toCompleteProfileRequest(validValues(), 'ADMIN')).toEqual({
      name: '합성 사용자',
      studentId: '1'.repeat(6),
      department: '인공지능학부',
    });
  });
});

describe('설정 화면 프로필 갱신', () => {
  it('이미 저장된 학번은 검증도 요청도 하지 않는다', () => {
    const values = settingsValues();

    expect(validateSettingsProfileForm(values, 'STUDENT')).toEqual({
      name: null,
      studentId: null,
      department: null,
    });
    expect(toUpdateProfileRequest(values, 'STUDENT')).toEqual({
      name: '합성 사용자',
      department: '인공지능학부',
    });
    expect(toUpdateProfileRequest(values, 'STUDENT')).not.toHaveProperty(
      'studentId',
    );
  });

  it('저장된 학번이 형식에 맞지 않아도 이름·학과 저장을 막지 않는다', () => {
    // 예전에 들어간 값은 사용자가 고칠 수 없다. 그것 때문에 저장을 막으면 갇힌다.
    const values = settingsValues({
      studentId: '12A456',
      savedStudentId: '12A456',
    });

    expect(validateSettingsProfileForm(values, 'STUDENT').studentId).toBeNull();
    expect(toUpdateProfileRequest(values, 'STUDENT')).toEqual({
      name: '합성 사용자',
      department: '인공지능학부',
    });
  });

  it('학번이 없는 교직원은 비워 둔 채로 저장할 수 있다', () => {
    const values = settingsValues({ studentId: '', savedStudentId: '' });

    expect(validateSettingsProfileForm(values, 'STAFF').studentId).toBeNull();
    expect(toUpdateProfileRequest(values, 'STAFF')).toEqual({
      name: '합성 사용자',
      department: '인공지능학부',
    });
    expect(toUpdateProfileRequest(values, 'STAFF')).not.toHaveProperty(
      'studentId',
    );
  });

  it('학생은 학번을 비우면 저장할 수 없다', () => {
    const values = settingsValues({ studentId: '', savedStudentId: '' });

    expect(validateSettingsProfileForm(values, 'STUDENT').studentId).toBe(
      '학번은 숫자 6자리로 입력해 주세요.',
    );
    expect(toUpdateProfileRequest(values, 'STUDENT')).toBeNull();
  });

  it('이름·학과가 비면 갱신 요청을 만들지 않는다', () => {
    expect(
      toUpdateProfileRequest(
        settingsValues({ name: ' ', departmentOption: '' }),
        'STUDENT',
      ),
    ).toBeNull();
  });
});
