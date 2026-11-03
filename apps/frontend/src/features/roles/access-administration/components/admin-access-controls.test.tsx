import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

import { deriveAdminAccessGuards } from '../admin-access-detail-api';
import type { AdminAccessDirectoryItem } from '../independent-authority-api';
import { AdminAccessControl } from './admin-access-controls';

const PENDING_REQUEST = {
  id: 'req-1',
  status: 'PENDING',
  createdAt: '2026-07-30T00:00:00.000Z',
} as const;

function item(
  overrides: Partial<AdminAccessDirectoryItem> = {},
): AdminAccessDirectoryItem {
  return {
    id: 'row-1',
    githubLogin: 'octocat',
    name: '합성 사용자',
    role: 'STUDENT',
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
    approvalStatus: 'NOT_REQUIRED',
    approvalRequestId: null,
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    createdAt: '2026-07-29T00:00:00.000Z',
    pendingRequest: null,
    lastLoginAt: null,
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

function renderAll(
  target: AdminAccessDirectoryItem,
  layout: 'field' | 'cell' | 'stacked',
  onRequestAction = vi.fn(),
  disabled = false,
) {
  const common = {
    target,
    disabled,
    onRequestAction,
    layout,
    idPrefix: 'row-1',
  } as const;
  act(() => {
    root.render(
      <div>
        <AdminAccessControl kind="memberKind" {...common} />
        <AdminAccessControl kind="adminAccess" {...common} />
        <AdminAccessControl kind="accountStatus" {...common} />
      </div>,
    );
  });
  return onRequestAction;
}

function trigger(name: string): HTMLButtonElement {
  const found = container.querySelector(`[aria-label="${name}"]`);
  if (!(found instanceof HTMLButtonElement)) {
    throw new TypeError(`접근성 이름으로 컨트롤을 찾지 못했습니다: ${name}`);
  }
  return found;
}

function open(element: HTMLButtonElement): HTMLElement {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const listbox = document.getElementById(
    element.getAttribute('aria-controls') ?? '',
  );
  if (!listbox) throw new TypeError('목록을 열지 못했습니다.');
  return listbox;
}

function option(listbox: HTMLElement, label: string): HTMLElement {
  const found = Array.from(
    listbox.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!found) throw new TypeError(`선택지를 찾지 못했습니다: ${label}`);
  return found;
}

function isDisabled(element: HTMLElement): boolean {
  return (
    element.getAttribute('aria-disabled') === 'true' ||
    element.hasAttribute('data-disabled')
  );
}

describe('shared access controls', () => {
  it.each(['field', 'cell', 'stacked'] as const)(
    'keeps read-only membership and labels in %s layout',
    (layout) => {
      renderAll(item(), layout);
      expect(
        container.querySelector('#row-1-member-kind-control'),
      ).toBeInstanceOf(HTMLSpanElement);
      expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(2);
      expect(container.querySelectorAll('label')).toHaveLength(
        layout === 'cell' ? 0 : 2,
      );
      if (layout !== 'cell')
        expect(
          container
            .querySelector('#row-1-member-kind-control')
            ?.getAttribute('aria-labelledby'),
        ).toBe('row-1-member-kind-control-label');
    },
  );
  it.each(['cell', 'stacked'] as const)(
    'renders only membership text without reset or its reason in %s layout',
    (layout) => {
      const request = renderAll(
        item({ pendingRequest: PENDING_REQUEST, isSelf: true }),
        layout,
      );
      const memberKind = container.querySelector('#row-1-member-kind-control');
      expect(memberKind?.textContent).toBe('학생');
      expect(
        Array.from(container.querySelectorAll('button')).some(
          (button) => button.textContent === '가입 유형 되돌리기',
        ),
      ).toBe(false);
      expect(
        container.querySelector('#row-1-member-kind-reset-reason'),
      ).toBeNull();
      act(() => {
        memberKind?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(request).not.toHaveBeenCalled();
    },
  );
  it('blocks all mutation controls while processing', () => {
    renderAll(item(), 'cell', vi.fn(), true);
    expect(
      Array.from(container.querySelectorAll('button')).every(
        (button) => button.disabled,
      ),
    ).toBe(true);
  });
  it('keeps incomplete profile admin grants blocked', () => {
    const incomplete = item({ isProfileComplete: false });
    renderAll(incomplete, 'cell');
    const listbox = open(trigger('합성 사용자 관리자 접근'));
    expect(isDisabled(option(listbox, '허용'))).toBe(true);
    expect(isDisabled(option(listbox, '비허용'))).toBe(false);
    expect(
      deriveAdminAccessGuards(incomplete).elevatedRoleBlockedReason,
    ).not.toBeNull();
  });
  it('keeps self deactivation and admin revocation blocked', () => {
    renderAll(item({ isSelf: true, hasAdminAccess: true }), 'cell');
    expect(
      isDisabled(option(open(trigger('합성 사용자 관리자 접근')), '비허용')),
    ).toBe(true);
    expect(
      isDisabled(option(open(trigger('합성 사용자 계정 상태')), '비활성')),
    ).toBe(true);
  });
});
