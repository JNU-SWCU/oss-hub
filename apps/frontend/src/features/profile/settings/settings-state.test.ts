import { describe, expect, it } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import { OTHER_DEPARTMENT } from '../departments';
import {
  classifyNotificationChannelApiError,
  NotificationChannelResponseError,
} from './notification-channel-api';
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

  it('교직원이 학번을 비워 두면 오류 없이 통과한다', () => {
    const empty = validValues({ studentId: '', savedStudentId: '' });
    const errors = validateSettingsForm(empty, true, 'STAFF');

    expect(errors.studentId).toBeNull();
    expect(isSettingsFormValid(errors)).toBe(true);
    expect(toSettingsProfileRequest(empty, 'STAFF')).not.toHaveProperty(
      'studentId',
    );
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
    '부분 저장 실패(%s) 안내는 프로필이 저장됐다는 사실부터 말한다',
    (kind) => {
      expect(notificationSaveFailureMessage(kind)).toContain(
        '프로필은 저장했습니다.',
      );
    },
  );

  /**
   * 입력 보존을 말하는 것은 "다시 눌러 보라"는 뜻이다. 그래서 다시 눌러 결과가
   * 달라질 수 있는 경우에만 말한다 — 권한이 없는 사람에게 입력이 남아 있다고
   * 알려 봐야 할 수 있는 일이 없고, 오히려 재시도를 권하는 것으로 읽힌다.
   */
  it.each(['not-found', 'generic'] as const)(
    '다시 시도할 수 있는 실패(%s)에만 입력이 남아 있음을 알린다',
    (kind) => {
      expect(notificationSaveFailureMessage(kind)).toContain(
        '입력한 값은 화면에 그대로 두었으니',
      );
    },
  );

  it('권한이 없어 다시 눌러도 소용없는 경우에는 입력 보존 대신 문의처를 준다', () => {
    const message = notificationSaveFailureMessage('forbidden');

    expect(message).not.toContain('입력한 값은 화면에 그대로 두었으니');
    expect(message).toContain('사업단 관리자에게 문의해 주세요');
  });

  it('부분 저장 실패 안내는 권한 문제와 일시적 실패의 다음 행동을 구분한다', () => {
    expect(notificationSaveFailureMessage('forbidden')).toContain(
      '사업단 관리자에게 문의해 주세요',
    );
    expect(notificationSaveFailureMessage('generic')).toContain(
      '저장을 다시 눌러 주세요',
    );
  });

  /**
   * 회귀 방지 — 안내가 **거짓일 수 있는 최종 상태를 단정하지 않는가**.
   *
   * 백엔드는 값을 먼저 쓰고(`notification-settings.repository.ts`의 `user.updateMany`)
   * 그 뒤에 다시 읽어 응답을 만든다. 그래서 오류를 받았다고 해서 값이 안 바뀐 것이
   * 아니다. 아래 셋은 모두 **저장이 이미 끝났을 수 있는** 실제 오류 객체다.
   * 여기서 "이전 값으로 남아 있다"고 말하면 사용자는 화면과 다른 서버 상태를
   * 사실로 믿고 넘어간다 — 안내가 없는 것보다 나쁘다.
   */
  it.each([
    [
      '쓰기 뒤 조회가 터진 500',
      new ApiError(problemDetail(500, 'API_000')) as unknown,
    ],
    [
      '200을 받았지만 형식이 다른 응답',
      new NotificationChannelResponseError() as unknown,
    ],
    ['응답을 못 받은 연결 실패', new TypeError('Failed to fetch') as unknown],
  ])(
    '실제 오류(%s)에는 알림 값이 이전 값이라고 단정하지 않는다',
    (_label, error) => {
      const kind = classifyNotificationChannelApiError(error);
      expect(kind).toBe('generic');

      // 화면은 'unauthorized'를 먼저 걸러 첫 화면으로 보낸 뒤에야 이 문구를 만든다
      // (settings-screen.tsx). 테스트도 같은 좁히기를 거쳐 실제 호출 경로를 흉내낸다.
      if (kind === 'unauthorized') throw new Error('unreachable');
      const message = notificationSaveFailureMessage(kind);

      // 단정 금지 — "저장되지 않았다"도 "이전 값으로 남아 있다"도 참이 아닐 수 있다.
      expect(message).not.toContain('이전 값으로 남아 있습니다');
      expect(message).not.toContain('저장되지 않아');
      // 대신 불명임을 말하고, 지금 값을 확인할 방법을 준다.
      expect(message).toContain('저장됐는지 확인하지 못했습니다');
      expect(message).toContain('설정 화면을 새로 열어 지금 저장된 값을 확인');
    },
  );

  /**
   * 반대쪽 못박기 — 단정할 수 있는 경로까지 뭉뚱그리지 않는다.
   * 403은 저장 단계에 닿기 전에 guard가 막으므로 값은 확실히 그대로다.
   */
  it('권한 거절(403 NOT_001)에는 이전 값 그대로임을 단정해도 된다', () => {
    const kind = classifyNotificationChannelApiError(
      new ApiError(problemDetail(403, 'NOT_001')),
    );
    expect(kind).toBe('forbidden');

    if (kind === 'unauthorized') throw new Error('unreachable');
    expect(notificationSaveFailureMessage(kind)).toContain(
      '이전 값으로 그대로 남아 있습니다',
    );
  });
});

function problemDetail(status: number, code: string): ProblemDetail {
  return {
    type: 'about:blank',
    title: '요청 처리 실패',
    status,
    detail: '합성 오류 상세',
    instance: 'urn:test:users:me:notification-email',
    code,
  };
}
