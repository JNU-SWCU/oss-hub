import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OTHER_DEPARTMENT } from '../departments';
import {
  PROFILE_DEPARTMENT_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
} from '../profile-state';
import { SettingsForm, SettingsSkeleton } from './components/settings-form';
import {
  notificationUnavailableMessage,
  validateSettingsForm,
} from './settings-state';
import type { ProfileRole } from '../profile-requirements';
import type { SettingsFormErrors, SettingsFormValues } from './types';

const noOp = () => undefined;
const TEN_DIGIT_PHONE = '1'.repeat(10);

function values(
  overrides: Partial<SettingsFormValues> = {},
): SettingsFormValues {
  return {
    name: '합성 사용자',
    studentId: '1'.repeat(6),
    savedStudentId: '1'.repeat(6),
    phone: TEN_DIGIT_PHONE,
    departmentOption: '인공지능학부',
    otherDepartment: '',
    notificationEmail: 'user@example.com',
    notifyEnabled: true,
    ...overrides,
  };
}

function renderForm(
  formValues: SettingsFormValues,
  options: {
    readonly role?: ProfileRole | null;
    readonly showValidationErrors?: boolean;
    readonly isSubmitting?: boolean;
    readonly submitError?: string | null;
    readonly toastMessage?: string | null;
    readonly notificationAvailable?: boolean;
    readonly isRetryingNotification?: boolean;
    readonly errors?: SettingsFormErrors;
  } = {},
) {
  const notificationAvailable = options.notificationAvailable ?? true;
  const role = options.role ?? 'STUDENT';
  const memberKind = role === 'ADMIN' ? null : role;
  return renderToStaticMarkup(
    <SettingsForm
      memberKind={memberKind}
      hasAdminAccess={role === 'ADMIN'}
      values={formValues}
      errors={
        options.errors ??
        validateSettingsForm(formValues, notificationAvailable, role)
      }
      showValidationErrors={options.showValidationErrors ?? false}
      notificationLoad={
        notificationAvailable
          ? { kind: 'ready' }
          : {
              kind: 'unavailable',
              message: notificationUnavailableMessage('forbidden'),
            }
      }
      isRetryingNotification={options.isRetryingNotification ?? false}
      isSubmitting={options.isSubmitting ?? false}
      submitError={options.submitError ?? null}
      toastMessage={options.toastMessage ?? null}
      onChange={noOp}
      onRetryNotification={noOp}
      onSubmit={noOp}
    />,
  );
}

/** 화면에 실제로 선 칸 옆 오류 줄 수. */
function fieldErrorCount(html: string): number {
  return html.split('data-slot="field-error"').length - 1;
}

describe('settings form view', () => {
  it('조회 중 설정 Skeleton을 표시한다', () => {
    const html = renderToStaticMarkup(<SettingsSkeleton />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('설정을 불러오는 중');
    expect(html).toContain('animate-pulse');
  });

  it('학생에게 학번은 읽기 전용이고 이름·전화번호·학과·알림 필드를 표시한다', () => {
    const html = renderForm(values(), { role: 'STUDENT' });

    expect(html).toContain('settings-student-id');
    expect(html).toMatch(/readOnly=""|readonly=""/i);
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-readonly="true"');
    expect(html).toContain('settings-name');
    expect(html).toContain('settings-phone');
    expect(html).toContain('settings-department');
    expect(html).toContain('settings-notification-email');
    expect(html).toContain('마감 임박 알림 받기');
    expect(html).toContain('합성 사용자');
    expect(html).toContain(TEN_DIGIT_PHONE);
    expect(html).toContain('user@example.com');
    expect(html).toContain('noValidate');
  });

  it('학번이 없는 교직원에게는 학번 칸을 아예 보여 주지 않는다', () => {
    // 학번은 학생만 가질 수 있다 — 교직원이 요청에 studentId를 실으면
    // 백엔드가 400으로 거절하므로(users.service.ts), 화면은 애초에 입력받지 않는다.
    const html = renderForm(values({ studentId: '', savedStudentId: '' }), {
      role: 'STAFF',
    });

    expect(html).not.toContain('settings-student-id');
    expect(html).toContain('settings-phone');
    expect(html).toContain('settings-name');
    expect(html).toContain('settings-department');
  });

  it('교직원도 이미 저장된 학번은 읽기 전용으로 보여 준다', () => {
    const html = renderForm(values(), { role: 'STAFF' });

    expect(html).toContain('settings-student-id');
    expect(html).toContain('aria-readonly="true"');
    expect(html).toContain('학번은 변경할 수 없습니다.');
    expect(html).toContain('1'.repeat(6));
    // 고정된 값에 "선택"을 붙이면 아직 고를 수 있다는 뜻이 된다.
    expect(html).not.toContain('>선택</span>');
  });

  it('관리자에게는 학번 칸만 감추고 학과는 받는다', () => {
    const html = renderForm(values({ studentId: '', savedStudentId: '' }), {
      role: 'ADMIN',
    });

    expect(html).not.toContain('settings-student-id');
    expect(html).toContain('settings-phone');
    expect(html).toContain('settings-department');
    expect(html).toContain('settings-name');
    expect(html).toContain('settings-notification-email');
  });

  it('학과가 비면 역할과 무관하게 필수 오류를 만든다', () => {
    const emptyProfileFields = values({
      studentId: '',
      savedStudentId: '',
      departmentOption: '',
      otherDepartment: '',
    });

    expect(
      renderForm(emptyProfileFields, {
        role: 'ADMIN',
        showValidationErrors: true,
      }),
    ).toContain('학과를 선택하거나 입력해 주세요.');
    expect(
      renderForm(emptyProfileFields, {
        role: 'STAFF',
        showValidationErrors: true,
      }),
    ).toContain('학과를 선택하거나 입력해 주세요.');
  });

  it('오류가 떠도 형식 안내를 남기고 둘 다 낭독되게 묶는다', () => {
    const html = renderForm(
      values({ studentId: '12', savedStudentId: '', phone: '1'.repeat(3) }),
      { showValidationErrors: true },
    );

    // 안내가 오류에 밀려나지 않는다 — 「숫자 6자리」가 필요한 순간이 틀렸을 때다.
    expect(html).toContain('숫자 6자리 · 사용자가 입력한 식별 정보');
    expect(html).toContain('학번은 숫자 6자리로 입력해 주세요.');
    expect(html).toContain(
      '프로그램 운영진이 선정·팀 운영 안내를 연락할 때 사용합니다.',
    );
    expect(html).toContain('전화번호는 숫자 10~11자리로 입력해 주세요.');

    // 낭독기가 안내와 오류를 둘 다 읽도록 컨트롤이 두 id를 함께 가리킨다.
    expect(html).toContain(
      'aria-describedby="settings-student-id-description settings-student-id-error"',
    );
    expect(html).toContain(
      'aria-describedby="settings-phone-description settings-phone-error"',
    );
  });

  it('오류가 없으면 안내만 가리킨다', () => {
    const html = renderForm(values(), { showValidationErrors: true });

    expect(html).toContain(
      'aria-describedby="settings-student-id-description"',
    );
    expect(html).toContain('aria-describedby="settings-phone-description"');
    expect(html).not.toContain('settings-phone-error');
  });

  it('잘못된 이름·전화번호·학과·이메일을 인라인 오류로 표시하고 저장 버튼은 제출 가능하게 둔다', () => {
    const html = renderForm(
      values({
        name: ' ',
        phone: '1'.repeat(3),
        departmentOption: OTHER_DEPARTMENT,
        otherDepartment: '',
        notificationEmail: 'not-an-email',
      }),
      { showValidationErrors: true },
    );

    expect(html).toContain('이름을 입력해 주세요.');
    expect(html).toContain('전화번호는 숫자 10~11자리로 입력해 주세요.');
    expect(html).toContain('학과를 선택하거나 입력해 주세요.');
    expect(html).toContain('이메일 형식이 올바르지 않습니다.');
    // 네 줄이 틀렸으므로 폼 맨 위에 그 개수가 선다(R-16). 기타 소속 입력은
    // 소속 줄 하나를 함께 쓰므로 따로 세지 않는다.
    expect(fieldErrorCount(html)).toBe(4);
    expect(html).toContain('고칠 칸이 4개 있습니다');
    expect(html.indexOf('data-slot="form-error-summary"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-slot="form-error-summary"')).toBeLessThan(
      html.indexOf('id="settings-name"'),
    );
    // 요약은 칸 옆 문구를 다시 적지 않는다.
    expect(html.split('이름을 입력해 주세요.').length - 1).toBe(1);
    // 무효 값이어도 클릭해 검증 메시지를 볼 수 있어야 한다. disabled는 저장 중만.
    expect(html).toContain('>저장</button>');
    expect(html).not.toMatch(/type="submit"[^>]*disabled/);
  });

  it('저장을 누르기 전에는 오류값이 넷이어도 요약을 그리지 않는다', () => {
    const html = renderForm(
      values({
        name: ' ',
        phone: '1'.repeat(3),
        departmentOption: OTHER_DEPARTMENT,
        otherDepartment: '',
        notificationEmail: 'not-an-email',
      }),
      { showValidationErrors: false },
    );

    expect(fieldErrorCount(html)).toBe(0);
    expect(html).not.toContain('data-slot="form-error-summary"');
  });

  it('학번을 아직 저장하지 않은 학생은 다섯 칸이 모두 틀릴 수 있고 요약도 다섯을 센다', () => {
    const html = renderForm(
      values({
        name: ' ',
        studentId: '',
        savedStudentId: '',
        phone: '',
        departmentOption: '',
        notificationEmail: 'not-an-email',
      }),
      { showValidationErrors: true },
    );

    expect(fieldErrorCount(html)).toBe(5);
    expect(html).toContain('고칠 칸이 5개 있습니다');
  });

  it('학번 칸이 감춰진 동안의 학번 오류는 요약 개수에서 뺀다', () => {
    // 회원 유형이 없는 관리자(null)를 화면은 학생 기준으로 검증해 학번 오류를
    // 만들지만, 학번 칸은 학생에게만 그리므로 그 오류 줄은 화면에 없다.
    const formValues = values({
      name: ' ',
      studentId: '',
      savedStudentId: '',
      phone: '',
    });
    const errors = validateSettingsForm(formValues, true, null);
    // 전제: 감춰진 칸에도 학번 오류는 만들어져 있다.
    expect(errors.studentId).toBeTruthy();
    const html = renderForm(formValues, {
      role: 'ADMIN',
      showValidationErrors: true,
      errors,
    });

    expect(html).not.toContain('settings-student-id');
    expect(fieldErrorCount(html)).toBe(2);
    expect(html).toContain('고칠 칸이 2개 있습니다');
  });

  it('저장 버튼 옆 서버 실패 경고는 요약 개수에 세지 않는다', () => {
    const html = renderForm(values({ notificationEmail: 'not-an-email' }), {
      showValidationErrors: true,
      submitError: '잠시 후 다시 시도해 주세요.',
    });

    expect(fieldErrorCount(html)).toBe(1);
    expect(html).toContain('잠시 후 다시 시도해 주세요.');
    expect(html).not.toContain('data-slot="form-error-summary"');
  });

  it('이메일 오류를 입력 필드와 연결한다', () => {
    const invalidHtml = renderForm(
      values({ notificationEmail: 'not-an-email' }),
      { showValidationErrors: true },
    );
    const validHtml = renderForm(values(), { showValidationErrors: true });

    expect(invalidHtml).toContain(
      'aria-describedby="settings-notification-email-error"',
    );
    expect(invalidHtml).toContain('id="settings-notification-email-error"');
    expect(validHtml).not.toContain('settings-notification-email-error');
    // 오류가 하나뿐이면 칸 옆 오류와 포커스 이동만 쓰고 요약은 없다(R-16).
    expect(fieldErrorCount(invalidHtml)).toBe(1);
    expect(invalidHtml).not.toContain('data-slot="form-error-summary"');
  });

  it('이름·기타 학과 길이 제한과 오류 메시지를 표시한다', () => {
    const html = renderForm(
      values({
        name: '가'.repeat(PROFILE_NAME_MAX_LENGTH + 1),
        departmentOption: OTHER_DEPARTMENT,
        otherDepartment: '나'.repeat(PROFILE_DEPARTMENT_MAX_LENGTH + 1),
      }),
      { showValidationErrors: true },
    );

    expect(html).toContain(`maxLength="${PROFILE_NAME_MAX_LENGTH}"`);
    expect(html).toContain(`maxLength="${PROFILE_DEPARTMENT_MAX_LENGTH}"`);
    expect(html).toContain('이름은 100자 이하로 입력해 주세요.');
    expect(html).toContain('학과는 100자 이하로 입력해 주세요.');
  });

  it('알림 API 불가 시 프로필만 편집하고 알림 섹션 안내를 보여 준다', () => {
    const html = renderForm(values({ notificationEmail: '' }), {
      notificationAvailable: false,
      showValidationErrors: true,
    });

    expect(html).toContain('알림 설정을 사용할 수 없습니다');
    expect(html).toContain(notificationUnavailableMessage('forbidden'));
    expect(html).not.toContain('settings-notification-email');
    expect(html).not.toContain('이메일 형식이 올바르지 않습니다.');
    // 프로필 필드는 유효하므로 저장 버튼은 활성(disabled 없음 on submit)
    expect(html).toContain('>저장</button>');
  });

  // 조회 실패를 표시만 하고 끝내면 전체 새로고침 전까지 복구할 길이 없다.
  it('알림 조회 실패 자리에 알림만 다시 불러오는 버튼을 둔다', () => {
    const html = renderForm(values(), { notificationAvailable: false });

    expect(html).toContain('알림 설정 다시 불러오기');
    // form 안의 버튼이므로 submit으로 새지 않아야 한다.
    expect(html).toContain('type="button"');
  });

  it('알림을 다시 불러오는 동안에는 버튼을 진행 상태로 잠근다', () => {
    const html = renderForm(values(), {
      notificationAvailable: false,
      isRetryingNotification: true,
    });

    expect(html).toContain('알림 설정 불러오는 중…');
    expect(html).not.toContain('알림 설정 다시 불러오기');
    expect(html).toContain('disabled=""');
  });

  it('저장 중 중복 클릭을 막고 성공 toast·실패 Alert를 표시한다', () => {
    const savingHtml = renderForm(values(), { isSubmitting: true });
    const toastHtml = renderForm(values(), {
      toastMessage: '저장되었습니다.',
    });
    const failedHtml = renderForm(values(), {
      submitError: '잠시 후 다시 시도해 주세요.',
    });

    expect(savingHtml).toContain('저장 중…');
    expect(savingHtml).toContain('disabled=""');
    expect(toastHtml).toContain('저장되었습니다.');
    expect(failedHtml).toContain('저장 결과를 확인해 주세요');
    expect(failedHtml).toContain('잠시 후 다시 시도해 주세요.');
  });
});
