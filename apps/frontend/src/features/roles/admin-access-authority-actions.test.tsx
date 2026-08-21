// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
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
    pendingRequest: null,
    lastLoginAt: null,
    profile: {
      name: '합성 사용자',
      studentId: '202601',
      department: '인공지능학부',
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

function authorityButton(label: string, value: '허용' | '해제') {
  const group = container.querySelector(`[aria-labelledby="${label}"]`);
  return Array.from(group?.querySelectorAll('button') ?? []).find((button) =>
    button.textContent?.endsWith(value),
  );
}

describe('independent admin authority controls', () => {
  it.each([
    ['student-admin', 'STUDENT', false, true],
    ['staff-only', 'STAFF', true, false],
    ['staff-admin', 'STAFF', true, true],
    ['admin-only', null, false, true],
  ] as const)(
    'renders canonical %s without legacy role projection',
    (_, memberKind, hasStaffAccess, hasAdminAccess) => {
      const html = renderToStaticMarkup(
        <AdminAccessMutationActions
          detail={detail({ memberKind, hasStaffAccess, hasAdminAccess })}
          processingAction={null}
          onRequestAction={() => {}}
        />,
      );
      expect(html.match(/role="radiogroup"/g)).toHaveLength(3);
      expect(html.match(/aria-checked="true"/g)).toHaveLength(3);
      expect(html).not.toContain('canonical 관리 API');
    },
  );

  it('staff-admin revoke staff requests only REVOKE_STAFF_ACCESS', () => {
    const request = render(
      detail({
        memberKind: 'STAFF',
        hasStaffAccess: true,
        hasAdminAccess: true,
      }),
    );
    act(() =>
      authorityButton('admin-staff-access-control-label', '해제')?.click(),
    );
    expect(request).toHaveBeenCalledWith('REVOKE_STAFF_ACCESS');
  });

  it('staff-admin revoke admin requests only REVOKE_ADMIN_ACCESS', () => {
    const request = render(
      detail({
        memberKind: 'STAFF',
        hasStaffAccess: true,
        hasAdminAccess: true,
      }),
    );
    act(() =>
      authorityButton('admin-admin-access-control-label', '해제')?.click(),
    );
    expect(request).toHaveBeenCalledWith('REVOKE_ADMIN_ACCESS');
  });

  it('grants staff and admin with separate exact commands', () => {
    const request = render(detail());
    act(() =>
      authorityButton('admin-staff-access-control-label', '허용')?.click(),
    );
    act(() =>
      authorityButton('admin-admin-access-control-label', '허용')?.click(),
    );
    expect(request.mock.calls).toEqual([
      ['GRANT_STAFF_ACCESS'],
      ['GRANT_ADMIN_ACCESS'],
    ]);
  });

  it('disables same-state controls without emitting a mutation', () => {
    const request = render(detail({ hasAdminAccess: true }));
    const current = authorityButton('admin-admin-access-control-label', '허용');
    expect(current).toBeInstanceOf(HTMLButtonElement);
    expect((current as HTMLButtonElement).disabled).toBe(true);
    act(() => current?.click());
    expect(request).not.toHaveBeenCalled();
  });
});
