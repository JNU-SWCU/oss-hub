

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalAdminAccessDetail } from './independent-authority-api';
import { AdminAccessMutationActions } from './components/admin-access-mutation-actions';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function detail(
  overrides: Partial<CanonicalAdminAccessDetail> = {},
): CanonicalAdminAccessDetail {
  return {
    id: 'target',
    githubLogin: 'octocat',
    name: '합성 사용자',
    role: 'STUDENT',
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    createdAt: '2026-07-29T00:00:00.000Z',
    pendingRequest: null,
    lastLoginAt: null,
    profile: {
      name: '합성 사용자',
      studentId: '202601',
      department: '인공지능학부',
      staffNumber: null,
      isComplete: true,
    },
    ...overrides,
  };
}

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

function render(source: CanonicalAdminAccessDetail, onRequestAction = vi.fn()) {
  act(() => {
    root.render(
      <AdminAccessMutationActions
        detail={source}
        processingAction={null}
        onRequestAction={onRequestAction}
      />,
    );
  });
  return onRequestAction;
}

function control(controlId: string): HTMLButtonElement {
  const trigger = container.querySelector(`#${controlId}`);
  if (
    !(trigger instanceof HTMLButtonElement) ||
    trigger.getAttribute('role') !== 'combobox'
  ) {
    throw new TypeError(`드롭다운을 찾지 못했습니다: ${controlId}`);
  }
  return trigger;
}

function controlValue(controlId: string): string {
  return (
    control(controlId)
      .querySelector<HTMLElement>('[data-slot="select-value"]')
      ?.textContent?.trim() ?? ''
  );
}

function openControl(
  controlId: string,
  method: 'pointer' | 'keyboard' = 'pointer',
): HTMLElement {
  const trigger = control(controlId);
  act(() => {
    if (method === 'keyboard') {
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    } else {
      trigger.dispatchEvent(
        new PointerEvent('pointerdown', {
          button: 0,
          bubbles: true,
          cancelable: true,
          pointerType: 'mouse',
        }),
      );
      trigger.dispatchEvent(
        new PointerEvent('pointerup', {
          button: 0,
          bubbles: true,
          cancelable: true,
          pointerType: 'mouse',
        }),
      );
      trigger.click();
    }
  });

  const listboxId = trigger.getAttribute('aria-controls');
  const listbox = listboxId
    ? document.getElementById(listboxId)
    : document.querySelector<HTMLElement>(
        '[role="listbox"][data-state="open"]',
      );
  if (!listbox || listbox.getAttribute('data-state') !== 'open') {
    throw new TypeError(`목록을 열지 못했습니다: ${controlId}`);
  }
  return listbox;
}

function choose(controlId: string, value: string) {
  const labels: Record<string, string> = {
    UNCONFIRMED: '미지정',
    STUDENT: '학생',
    STAFF: '교직원',
    NONE: '비허용',
    GRANTED: '허용',
    ACTIVE: '활성',
    DEACTIVATED: '비활성',
  };
  const listbox = openControl(controlId);
  const option = Array.from(
    listbox.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((candidate) => candidate.textContent?.trim() === labels[value]);
  if (!option) {
    throw new TypeError(`선택지를 찾지 못했습니다: ${controlId}=${value}`);
  }
  act(() => {
    option.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe('independent admin authority controls', () => {
  it.each([
    ['student-kind-without-staff-flag', 'STUDENT', false, 'STUDENT'],
    ['student-kind-with-staff-flag', 'STUDENT', true, 'STUDENT'],
    ['staff-kind-with-staff-flag', 'STAFF', true, 'STAFF'],
  ] as const)(
    'uses memberKind, not hasStaffAccess, as the member selector value (%s)',
    (_, memberKind, hasStaffAccess, expectedValue) => {
      render(detail({ memberKind, hasStaffAccess }));
      const labels = {
        STUDENT: '학생',
        STAFF: '교직원',
      } as const;
      expect(controlValue('admin-member-kind-control')).toBe(
        labels[expectedValue],
      );
    },
  );

  it('renders only canonical member-kind, admin, and status controls', () => {
    render(detail({ memberKind: 'STAFF', hasStaffAccess: true }));
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(3);
    expect(container.textContent).toContain('회원 유형');
  });

  it('opens listboxes through pointer and keyboard interaction', () => {
    render(detail({ memberKind: 'STAFF', hasStaffAccess: true }));

    const pointerListbox = openControl('admin-member-kind-control', 'pointer');
    expect(pointerListbox.querySelectorAll('[role="option"]')).toHaveLength(3);

    const keyboardListbox = openControl(
      'admin-access-status-control',
      'keyboard',
    );
    expect(keyboardListbox.querySelectorAll('[role="option"]')).toHaveLength(2);
  });

  it.each([
    ['STUDENT', 'STAFF', 'SET_MEMBER_STAFF'],
    ['STAFF', 'STUDENT', 'SET_MEMBER_STUDENT'],
  ] as const)(
    'selecting %s → %s requests the canonical member action',
    (currentMemberKind, nextMemberKind, action) => {
      const request = render(
        detail({
          memberKind: currentMemberKind,
          hasStaffAccess: currentMemberKind === 'STAFF',
        }),
      );
      choose('admin-member-kind-control', nextMemberKind);
      expect(request).toHaveBeenCalledWith(action);
    },
  );

  it('does not request a write when the current member kind is selected again', () => {
    const request = render(
      detail({ memberKind: 'STAFF', hasStaffAccess: true }),
    );
    choose('admin-member-kind-control', 'STAFF');
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps canonical STUDENT without a separate member-kind apply button', () => {
    const request = render(
      detail({ memberKind: 'STUDENT', hasStaffAccess: true }),
    );
    const applyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '회원 유형 적용',
    );
    expect(applyButton).toBeUndefined();
    expect(controlValue('admin-member-kind-control')).toBe('학생');
    choose('admin-member-kind-control', 'STAFF');
    expect(request).toHaveBeenCalledWith('SET_MEMBER_STAFF');
  });

  it('blocks an unconfirmed member kind instead of treating it as staff access', () => {
    render(detail({ memberKind: null, hasStaffAccess: false }));
    const trigger = control('admin-member-kind-control');
    expect(controlValue('admin-member-kind-control')).toBe('미지정');
    expect(trigger.disabled).toBe(true);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('keeps the controlled member kind after a pending change is cancelled', () => {
    const request = render(
      detail({ memberKind: 'STUDENT', hasStaffAccess: false }),
    );
    choose('admin-member-kind-control', 'STAFF');
    expect(request).toHaveBeenCalledWith('SET_MEMBER_STAFF');
    expect(controlValue('admin-member-kind-control')).toBe('학생');
  });
});
