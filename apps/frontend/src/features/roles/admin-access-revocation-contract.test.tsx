import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminDetail,
  adminHistory,
  adminMutation,
} from './admin-access-detail-test-fixture';
import { AdminAccessDetailContentForState } from './components/admin-access-detail-view';
import type { AdminAccessMutationAction } from './admin-access-mutation-policy';
import type { CanonicalAdminAccessDetail } from './independent-authority-api';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mountDialog(
  action: AdminAccessMutationAction,
  detailOverrides: Partial<CanonicalAdminAccessDetail> = {},
  mutationOverrides: {
    readonly processingAction?: AdminAccessMutationAction | null;
  } = {},
) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  act(() => {
    root.render(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: adminDetail({
            memberKind: 'STAFF',
            hasStaffAccess: true,
            hasAdminAccess: true,
            ...detailOverrides,
          }),
          history: adminHistory(),
        }}
        onRetry={() => {}}
        mutation={adminMutation({
          confirmAction: action,
          processingAction: mutationOverrides.processingAction ?? null,
          onCancel,
          onConfirm,
        })}
      />,
    );
  });
  const dialog = document.body.querySelector('[role="dialog"]');
  if (!(dialog instanceof HTMLElement)) {
    throw new TypeError('확인 다이얼로그를 찾지 못했습니다.');
  }
  return { dialog, onCancel, onConfirm };
}

function setInput(dialog: HTMLElement, id: string, value: string): void {
  const input = dialog.querySelector(`#${id}`);
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError(`입력란을 찾지 못했습니다: ${id}`);
  }
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function confirm(dialog: HTMLElement): void {
  const buttons = Array.from(dialog.querySelectorAll('button'));
  const confirmButton = buttons.at(-1);
  if (!(confirmButton instanceof HTMLButtonElement)) {
    throw new TypeError('확정 버튼을 찾지 못했습니다.');
  }
  act(() => {
    confirmButton.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
  });
}

describe('회원 유형 확인 다이얼로그', () => {
  it('공용 DialogShell과 한 줄 안내·한 단어 확정 문구를 쓴다', () => {
    const { dialog } = mountDialog('SET_MEMBER_STUDENT', {
      memberKind: 'STAFF',
      hasStaffAccess: true,
    });

    expect(dialog.dataset.slot).toBe('dialog-shell');
    expect(dialog.textContent).toContain('학생으로 변경');
    expect(dialog.textContent).toContain('교직원 접근 권한이 해제됩니다.');
    expect(dialog.textContent).toContain('변경');
    expect(dialog.textContent).not.toContain('회원 유형을 학생으로 변경');
    expect(dialog.textContent).not.toContain(
      '다른 접근 권한은 변경되지 않습니다.',
    );
  });

  it('학번과 학과가 없으면 학생 전환에 입력한 값을 onConfirm에 전달한다', () => {
    const { dialog, onConfirm } = mountDialog('SET_MEMBER_STUDENT', {
      profile: {
        name: '홍길동',
        studentId: null,
        department: null,
        staffNumber: null,
        isComplete: false,
      },
    });

    setInput(dialog, 'admin-member-kind-student-id', '202700');
    setInput(dialog, 'admin-member-kind-department', '컴퓨터공학부');
    confirm(dialog);

    expect(onConfirm).toHaveBeenCalledWith({
      studentId: '202700',
      department: '컴퓨터공학부',
    });
  });

  it('기존 학번과 학과는 입력 없이 확인 문구로 보이고 학번을 다시 쓰지 않는다', () => {
    const { dialog, onConfirm } = mountDialog('SET_MEMBER_STUDENT');

    expect(
      dialog.querySelector<HTMLInputElement>('#admin-member-kind-student-id'),
    ).toBeNull();
    expect(
      dialog.querySelector<HTMLInputElement>('#admin-member-kind-department'),
    ).toBeNull();
    expect(dialog.textContent).toContain('202601');
    expect(dialog.textContent).toContain('인공지능학부');
    confirm(dialog);

    expect(onConfirm).toHaveBeenCalledWith({
      department: '인공지능학부',
    });
  });

  it('기존 학번이 없으면 학번만 입력하고 저장된 학과를 함께 보낸다', () => {
    const { dialog, onConfirm } = mountDialog('SET_MEMBER_STUDENT', {
      profile: {
        name: '홍길동',
        studentId: null,
        department: '인공지능학부',
        staffNumber: null,
        isComplete: true,
      },
    });

    expect(
      dialog.querySelector<HTMLInputElement>('#admin-member-kind-student-id'),
    ).toBeInstanceOf(HTMLInputElement);
    expect(
      dialog.querySelector<HTMLInputElement>('#admin-member-kind-department'),
    ).toBeNull();
    setInput(dialog, 'admin-member-kind-student-id', '202700');
    confirm(dialog);

    expect(onConfirm).toHaveBeenCalledWith({
      studentId: '202700',
      department: '인공지능학부',
    });
  });

  it('기존 학번만 있으면 학과만 입력한다', () => {
    const { dialog, onConfirm } = mountDialog('SET_MEMBER_STUDENT', {
      profile: {
        name: '홍길동',
        studentId: '202601',
        department: null,
        staffNumber: null,
        isComplete: false,
      },
    });

    expect(
      dialog.querySelector<HTMLInputElement>('#admin-member-kind-student-id'),
    ).toBeNull();
    expect(
      dialog.querySelector<HTMLInputElement>('#admin-member-kind-department'),
    ).toBeInstanceOf(HTMLInputElement);
    setInput(dialog, 'admin-member-kind-department', '컴퓨터공학부');
    confirm(dialog);

    expect(onConfirm).toHaveBeenCalledWith({
      department: '컴퓨터공학부',
    });
  });

  it('새 학번은 숫자 6자리를 벗어나면 확정하지 않고 입력란에 포커스한다', () => {
    const { dialog, onConfirm } = mountDialog('SET_MEMBER_STUDENT', {
      profile: {
        name: '홍길동',
        studentId: null,
        department: '인공지능학부',
        staffNumber: null,
        isComplete: true,
      },
    });

    setInput(dialog, 'admin-member-kind-student-id', '12345');
    confirm(dialog);

    const studentIdInput = dialog.querySelector<HTMLInputElement>(
      '#admin-member-kind-student-id',
    );
    expect(onConfirm).not.toHaveBeenCalled();
    expect(studentIdInput?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(studentIdInput);
  });

  it('저장된 학과는 NFC·공백 정규화한 값을 보낸다', () => {
    const { dialog, onConfirm } = mountDialog('SET_MEMBER_STUDENT', {
      profile: {
        name: '홍길동',
        studentId: '202601',
        department: '  인공지능학부  ',
        staffNumber: null,
        isComplete: true,
      },
    });

    confirm(dialog);

    expect(onConfirm).toHaveBeenCalledWith({
      department: '인공지능학부',
    });
  });

  it('교직원 전환의 빈 선택 입력은 명시적인 null staffNumber로 전달한다', () => {
    const { dialog, onConfirm } = mountDialog('SET_MEMBER_STAFF', {
      memberKind: 'STUDENT',
      hasStaffAccess: false,
    });

    setInput(dialog, 'admin-member-kind-staff-number', '');
    confirm(dialog);

    expect(onConfirm).toHaveBeenCalledWith({ staffNumber: null });
  });

  it('교직원 전환은 입력한 선택 staffNumber를 metadata로 전달한다', () => {
    const { dialog, onConfirm } = mountDialog('SET_MEMBER_STAFF', {
      memberKind: 'STUDENT',
      hasStaffAccess: false,
    });

    setInput(dialog, 'admin-member-kind-staff-number', 'STAFF-42');
    confirm(dialog);

    expect(onConfirm).toHaveBeenCalledWith({ staffNumber: 'STAFF-42' });
  });

  it('저장된 staffNumber가 없으면 선택 입력 안내를 연결한다', () => {
    const { dialog } = mountDialog('SET_MEMBER_STAFF', {
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      profile: {
        name: '홍길동',
        studentId: '202601',
        department: '인공지능학부',
        staffNumber: null,
        isComplete: true,
      },
    });

    const staffNumberInput = dialog.querySelector<HTMLInputElement>(
      '#admin-member-kind-staff-number',
    );
    const description = dialog.querySelector('[data-slot="field-description"]');
    expect(description?.textContent).toBe('사번을 입력해 주세요.');
    expect(staffNumberInput?.getAttribute('aria-describedby')).toBe(
      description?.id,
    );
  });

  it('저장된 staffNumber가 있으면 삭제 도움말만 읽힌다', () => {
    const { dialog } = mountDialog('SET_MEMBER_STAFF', {
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      profile: {
        name: '홍길동',
        studentId: '202601',
        department: '인공지능학부',
        staffNumber: 'STAFF-42',
        isComplete: true,
      },
    });

    const staffNumberInput = dialog.querySelector<HTMLInputElement>(
      '#admin-member-kind-staff-number',
    );
    const description = dialog.querySelector('[data-slot="field-description"]');
    expect(description?.textContent).toBe('비우면 등록된 번호가 삭제됩니다.');
    expect(staffNumberInput?.getAttribute('aria-describedby')).toBe(
      description?.id,
    );
  });

  it('교직원 전환은 변경 문구를 쓴다', () => {
    const { dialog } = mountDialog('SET_MEMBER_STAFF', {
      memberKind: 'STUDENT',
      hasStaffAccess: false,
    });

    expect(dialog.textContent).toContain('교직원으로 변경');
    expect(dialog.textContent).toContain('교직원 접근 권한이 부여됩니다.');
    expect(dialog.textContent).toContain('변경');
    expect(dialog.textContent).not.toContain('저장');
  });

  it('취소는 입력을 확정하지 않고 onCancel만 호출한다', () => {
    const { dialog, onCancel, onConfirm } = mountDialog('SET_MEMBER_STAFF', {
      memberKind: 'STUDENT',
      hasStaffAccess: false,
    });
    setInput(dialog, 'admin-member-kind-staff-number', 'STAFF-42');

    const cancelButton = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '취소',
    );
    expect(cancelButton).toBeInstanceOf(HTMLButtonElement);
    act(() => {
      cancelButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Escape는 취소하고 처리 중에는 Escape와 확정을 막는다', () => {
    const first = mountDialog('SET_MEMBER_STUDENT', {
      profile: {
        name: '홍길동',
        studentId: '202601',
        department: '인공지능학부',
        staffNumber: null,
        isComplete: true,
      },
    });
    act(() => {
      first.dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(first.onCancel).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    root = createRoot(container);

    const busy = mountDialog(
      'SET_MEMBER_STAFF',
      { memberKind: 'STUDENT', hasStaffAccess: false },
      { processingAction: 'SET_MEMBER_STAFF' },
    );
    const confirmButton = busy.dialog.querySelector(
      'button[data-variant="default"]',
    );
    expect((confirmButton as HTMLButtonElement | null)?.disabled).toBe(true);
    act(() => {
      busy.dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(busy.onCancel).not.toHaveBeenCalled();
    expect(busy.onConfirm).not.toHaveBeenCalled();
  });
});

describe('관리자 접근 회수 확인', () => {
  it('관리자 접근 회수는 member fields 없이 confirm을 dispatch한다', () => {
    const { dialog, onConfirm } = mountDialog('REVOKE_ADMIN_ACCESS');
    confirm(dialog);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(
      dialog.querySelector('button:last-child')?.getAttribute('data-variant'),
    ).toBe('destructive');
  });
});
