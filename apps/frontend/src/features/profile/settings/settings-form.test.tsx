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
import type { SettingsFormValues } from './types';

const noOp = () => undefined;

function values(
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
  } = {},
) {
  const notificationAvailable = options.notificationAvailable ?? true;
  const role = options.role ?? 'STUDENT';
  return renderToStaticMarkup(
    <SettingsForm
      role={role}
      values={formValues}
      errors={validateSettingsForm(formValues, notificationAvailable, role)}
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

describe('settings form view', () => {
  it('조회 중 설정 Skeleton을 표시한다', () => {
    const html = renderToStaticMarkup(<SettingsSkeleton />);
    expect(html).toContain('aria-label="설정을 불러오는 중"');
    expect(html).toContain('animate-pulse');
  });

  it('학생에게 학번은 읽기 전용이고 이름·학과·알림 필드를 표시한다', () => {
    const html = renderForm(values(), { role: 'STUDENT' });

    expect(html).toContain('settings-student-id');
    expect(html).toMatch(/readOnly=""|readonly=""/i);
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-readonly="true"');
    expect(html).toContain('settings-name');
    expect(html).toContain('settings-department');
    expect(html).toContain('settings-notification-email');
    expect(html).toContain('마감 임박 알림 받기');
    expect(html).toContain('합성 사용자');
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
    expect(html).toContain('settings-name');
    expect(html).toContain('settings-department');
    expect(html).toContain('이름과 학과를 수정할 수 있습니다.');
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

  it('관리자에게는 학번·학과 칸을 모두 감춘다', () => {
    const html = renderForm(values({ studentId: '', savedStudentId: '' }), {
      role: 'ADMIN',
    });

    expect(html).not.toContain('settings-student-id');
    expect(html).not.toContain('settings-department');
    expect(html).toContain('settings-name');
    expect(html).toContain('이름을 수정할 수 있습니다.');
    expect(html).toContain('settings-notification-email');
  });

  it('감춘 항목은 필수 오류를 만들지 않는다', () => {
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
    ).not.toContain('학과를 선택하거나 입력해 주세요.');
    expect(
      renderForm(emptyProfileFields, {
        role: 'STAFF',
        showValidationErrors: true,
      }),
    ).toContain('학과를 선택하거나 입력해 주세요.');
  });

  it('잘못된 이름·학과·이메일을 인라인 오류로 표시하고 저장 버튼은 제출 가능하게 둔다', () => {
    const html = renderForm(
      values({
        name: ' ',
        departmentOption: OTHER_DEPARTMENT,
        otherDepartment: '',
        notificationEmail: 'not-an-email',
      }),
      { showValidationErrors: true },
    );

    expect(html).toContain('이름을 입력해 주세요.');
    expect(html).toContain('학과를 선택하거나 입력해 주세요.');
    expect(html).toContain('이메일 형식이 올바르지 않습니다.');
    // 무효 값이어도 클릭해 검증 메시지를 볼 수 있어야 한다. disabled는 저장 중만.
    expect(html).toContain('>저장</button>');
    expect(html).not.toMatch(/type="submit"[^>]*disabled/);
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
    expect(failedHtml).toContain('설정을 저장하지 못했습니다');
    expect(failedHtml).toContain('잠시 후 다시 시도해 주세요.');
  });
});
