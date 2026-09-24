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
 * 묶음마다 드롭다운 하나다 — 지금 값이 선택돼 있고, 나머지 값이 후행 상태로 선다.
 * 값을 고르는 일이 곧 변경 요청이므로 테스트도 `change`로 고른다.
 */
function chooseAuthority(controlId: string, value: 'GRANTED' | 'NONE') {
  const select = container.querySelector(`#${controlId}`);
  if (!(select instanceof HTMLSelectElement)) {
    throw new TypeError(`드롭다운을 찾지 못했습니다: ${controlId}`);
  }
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    'value',
  )?.set;
  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
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
      // 라디오도, 상태 문자열을 담은 버튼도 없다 — 묶음마다 `<select>` 하나다.
      expect(html).not.toContain('role="radiogroup"');
      expect(html).not.toContain('<button');
      expect(html.match(/<select/g)).toHaveLength(3);
      // 「없음」·「있음」은 두 묶음의 선택지로 각각 두 번씩 늘 그려지고,
      // 지금 값만 `selected`로 선다.
      expect(html.match(/있음/g) ?? []).toHaveLength(2);
      expect(html.match(/없음/g) ?? []).toHaveLength(2);
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
    chooseAuthority('admin-staff-access-control', 'NONE');
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
    chooseAuthority('admin-admin-access-control', 'NONE');
    expect(request).toHaveBeenCalledWith('REVOKE_ADMIN_ACCESS');
  });

  it('grants staff and admin with separate exact commands', () => {
    const request = render(detail());
    chooseAuthority('admin-staff-access-control', 'GRANTED');
    chooseAuthority('admin-admin-access-control', 'GRANTED');
    expect(request.mock.calls).toEqual([
      ['GRANT_STAFF_ACCESS'],
      ['GRANT_ADMIN_ACCESS'],
    ]);
  });

  it('이미 가진 값을 다시 골라도 쓰기 요청은 나가지 않는다', () => {
    const request = render(detail({ hasAdminAccess: true }));
    chooseAuthority('admin-admin-access-control', 'GRANTED');
    expect(request).not.toHaveBeenCalled();
  });
});
