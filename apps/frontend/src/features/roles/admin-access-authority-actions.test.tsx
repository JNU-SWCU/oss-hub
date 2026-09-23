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
    createdAt: '2026-07-29T00:00:00.000Z',
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

/**
 * #1365 이후 묶음마다 버튼은 하나다 — 「허용」과 「회수」 중 지금 값의 반대만
 * 그려지므로, 찾은 버튼의 글자가 기대한 행동인지까지 확인한다.
 */
function authorityButton(labelId: string, action: '허용' | '회수') {
  const button = container
    .querySelector(`#${labelId}`)
    ?.closest('div')
    ?.querySelector('button');
  return button?.textContent?.endsWith(action) ? button : undefined;
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
      // #1365 — 묶음마다 지금 값 글자 하나와 행동 버튼 하나. 라디오는 없다.
      expect(html).not.toContain('role="radiogroup"');
      expect(html.match(/<button/g)).toHaveLength(3);
      const grantedCount = [hasStaffAccess, hasAdminAccess].filter(
        Boolean,
      ).length;
      expect(html.match(/허용됨/g) ?? []).toHaveLength(grantedCount);
      expect(html.match(/없음/g) ?? []).toHaveLength(2 - grantedCount);
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
      authorityButton('admin-staff-access-control-label', '회수')?.click(),
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
      authorityButton('admin-admin-access-control-label', '회수')?.click(),
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

  it('같은 값으로 가는 컨트롤은 아예 그려지지 않는다', () => {
    const request = render(detail({ hasAdminAccess: true }));
    // 이미 허용된 묶음에는 「허용」 버튼이 없고, 「회수」 하나만 선다.
    expect(
      authorityButton('admin-admin-access-control-label', '허용'),
    ).toBeUndefined();
    expect(
      authorityButton('admin-admin-access-control-label', '회수'),
    ).toBeInstanceOf(HTMLButtonElement);
    expect(request).not.toHaveBeenCalled();
  });
});
