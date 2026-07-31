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
      departmentOption: OTHER_DEPARTMENT,
      otherDepartment: '합성 융합전공',
      notificationEmail: 'staff@example.com',
      notifyEnabled: false,
    });
  });

  it('완료 프로필 갱신 요청에는 학번을 넣지 않는다', () => {
    expect(toSettingsProfileRequest(validValues(), 'STUDENT')).toEqual({
      name: '합성 사용자',
      department: '인공지능학부',
    });
    expect(
      toSettingsProfileRequest(validValues(), 'STUDENT'),
    ).not.toHaveProperty('studentId');
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
