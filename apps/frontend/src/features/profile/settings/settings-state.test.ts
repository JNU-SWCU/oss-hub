import { describe, expect, it } from 'vitest';
import { OTHER_DEPARTMENT } from '../departments';
import {
  createInitialSettingsForm,
  isSettingsFormValid,
  notificationSaveFailureMessage,
  notificationUnavailableMessage,
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

  // 판정 기준은 존댓말이 아니라 "읽은 사람이 다음에 무엇을 할 수 있는가"다.
  it.each(['forbidden', 'not-found', 'generic'] as const)(
    '알림 조회 실패(%s) 안내는 프로필 편집 가능 여부와 다음 행동을 함께 말한다',
    (kind) => {
      const message = notificationUnavailableMessage(kind);

      expect(message).toContain('프로필은 그대로 수정·저장할 수 있고');
      expect(message).toMatch(/다시 불러오기|사업단 관리자에게 문의/);
    },
  );

  it('알림 조회 실패 안내는 원인별로 다른 다음 행동을 제시한다', () => {
    // 권한이 없는 경우 재시도만 반복해도 풀리지 않는다 — 문의처를 준다.
    expect(notificationUnavailableMessage('forbidden')).toContain(
      '사업단 관리자에게 문의해 주세요',
    );
    // 일시적 실패는 그 자리에서 다시 불러오면 된다.
    expect(notificationUnavailableMessage('generic')).toContain(
      '알림 설정만 아래 다시 불러오기로 다시 시도할 수 있습니다',
    );
  });

  it.each(['forbidden', 'not-found', 'generic'] as const)(
    '부분 저장 실패(%s) 안내는 프로필 저장 성공과 알림에 남은 값을 함께 말한다',
    (kind) => {
      const message = notificationSaveFailureMessage(kind);

      expect(message).toContain('프로필은 저장했습니다.');
      // 알림 설정이 "어떤 값으로 남았는지"가 드러나야 한다.
      expect(message).toContain('이전 값으로');
    },
  );

  it('부분 저장 실패 안내는 권한 문제와 일시적 실패의 다음 행동을 구분한다', () => {
    expect(notificationSaveFailureMessage('forbidden')).toContain(
      '사업단 관리자에게 문의해 주세요',
    );

    for (const kind of ['not-found', 'generic'] as const) {
      const message = notificationSaveFailureMessage(kind);
      // 입력이 보존된다는 사실과, 그래서 저장만 다시 누르면 된다는 행동.
      expect(message).toContain('입력한 값은 화면에 그대로 두었으니');
      expect(message).toContain('저장을 다시 눌러 주세요');
    }
  });
});
