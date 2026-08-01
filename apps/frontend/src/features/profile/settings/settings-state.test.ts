import { describe, expect, it } from 'vitest';
import { OTHER_DEPARTMENT } from '../departments';
import {
  createInitialSettingsForm,
  isSettingsFormValid,
  toSettingsNotificationRequest,
  toSettingsProfileRequest,
  validateSettingsForm,
} from './settings-state';
import type { SettingsFormValues } from './types';

function validValues(
  overrides: Partial<SettingsFormValues> = {},
): SettingsFormValues {
  return {
    name: '합성 사용자',
    studentId: '1'.repeat(6),
    savedStudentId: '1'.repeat(6),
    departmentOption: '인공지능학부',
    otherDepartment: '',
    notificationEmail: 'user@example.com',
    notifyEnabled: true,
    ...overrides,
  };
}

describe('settings form state', () => {
  it('프로필·알림 설정으로 초기 폼을 만든다', () => {
    expect(
      createInitialSettingsForm(
        {
          name: '합성 사용자',
          studentId: '1'.repeat(6),
          department: '합성 융합전공',
          isComplete: true,
        },
        {
          notificationEmail: 'staff@example.com',
          notifyEnabled: false,
        },
      ),
    ).toEqual({
      name: '합성 사용자',
      studentId: '1'.repeat(6),
      savedStudentId: '1'.repeat(6),
      departmentOption: OTHER_DEPARTMENT,
      otherDepartment: '합성 융합전공',
      notificationEmail: 'staff@example.com',
      notifyEnabled: false,
    });
  });

  it('학번이 없는 프로필은 저장된 학번을 빈 문자열로 둔다', () => {
    expect(
      createInitialSettingsForm(
        {
          name: '합성 교직원',
          studentId: null,
          department: '인공지능학부',
          isComplete: true,
        },
        null,
      ),
    ).toMatchObject({ studentId: '', savedStudentId: '' });
  });

  it('이미 저장된 학번은 갱신 요청에 넣지 않는다', () => {
    expect(toSettingsProfileRequest(validValues(), 'STUDENT')).toEqual({
      name: '합성 사용자',
      department: '인공지능학부',
    });
    expect(
      toSettingsProfileRequest(validValues(), 'STUDENT'),
    ).not.toHaveProperty('studentId');
  });

  it('교직원이 처음 입력한 학번은 갱신 요청에 싣는다', () => {
    const firstFill = validValues({
      studentId: '2'.repeat(8),
      savedStudentId: '',
    });

    expect(validateSettingsForm(firstFill, true, 'STAFF').studentId).toBeNull();
    expect(toSettingsProfileRequest(firstFill, 'STAFF')).toEqual({
      name: '합성 사용자',
      studentId: '2'.repeat(8),
      department: '인공지능학부',
    });
  });

  it('교직원이 학번을 비워 두면 오류 없이 통과한다', () => {
    const empty = validValues({ studentId: '', savedStudentId: '' });
    const errors = validateSettingsForm(empty, true, 'STAFF');

    expect(errors.studentId).toBeNull();
    expect(isSettingsFormValid(errors)).toBe(true);
    expect(toSettingsProfileRequest(empty, 'STAFF')).not.toHaveProperty(
      'studentId',
    );
  });

  it('교직원이 넣은 학번의 형식이 틀리면 저장을 막는다', () => {
    const invalid = validValues({ studentId: '12A456', savedStudentId: '' });
    const errors = validateSettingsForm(invalid, true, 'STAFF');

    expect(errors.studentId).toBe('학번은 숫자 6~10자리로 입력해 주세요.');
    expect(isSettingsFormValid(errors)).toBe(false);
    expect(toSettingsProfileRequest(invalid, 'STAFF')).toBeNull();
  });

  it('알림 사용 가능할 때만 이메일을 검증한다', () => {
    const emptyEmail = validValues({ notificationEmail: '' });
    const withNotification = validateSettingsForm(emptyEmail, true, 'STUDENT');
    const withoutNotification = validateSettingsForm(
      emptyEmail,
      false,
      'STUDENT',
    );

    expect(withNotification.notificationEmail).toBe(
      '이메일 형식이 올바르지 않습니다.',
    );
    expect(isSettingsFormValid(withNotification)).toBe(false);
    expect(withoutNotification.notificationEmail).toBeNull();
    expect(isSettingsFormValid(withoutNotification)).toBe(true);
  });

  it('알림 요청은 이메일을 trim 한다', () => {
    expect(
      toSettingsNotificationRequest(
        validValues({
          notificationEmail: '  user@example.com  ',
          notifyEnabled: false,
        }),
      ),
    ).toEqual({
      notificationEmail: 'user@example.com',
      notifyEnabled: false,
    });
    expect(
      toSettingsNotificationRequest(validValues({ notificationEmail: 'bad' })),
    ).toBeNull();
  });
});
