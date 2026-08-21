// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

import type { AdminAccessDetail } from './admin-access-api';
import type { AdminAccessAuthoritySource } from './admin-access-authority';
import { AdminAccessMutationActions } from './components/admin-access-mutation-actions';

type AuthorityDetail = AdminAccessDetail & AdminAccessAuthoritySource;

function detail(overrides: Partial<AuthorityDetail> = {}): AuthorityDetail {
  return {
    id: 'target',
    githubLogin: 'octocat',
    name: '합성 사용자',
    role: 'STAFF',
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

describe('AdminAccessMutationActions 독립 접근 컨트롤', () => {
  it('교직원 접근과 관리자 접근을 별도 라디오그룹으로 렌더링한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessMutationActions
        detail={detail({
          memberKind: 'STUDENT',
          hasStaffAccess: false,
          hasAdminAccess: true,
        })}
        processingAction={null}
        onRequestAction={() => {}}
      />,
    );

    expect(html).toContain('교직원 접근');
    expect(html).toContain('관리자 접근');
    expect(html.match(/role="radiogroup"/g)).toHaveLength(3);
    expect(html).not.toContain('(현재)');
  });

  it('선택되지 않은 비활성도 outline이고 destructive가 아니다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessMutationActions
        detail={detail({ accountStatus: 'ACTIVE' })}
        processingAction={null}
        onRequestAction={() => {}}
      />,
    );

    expect(html).toContain('비활성');
    expect(html).not.toContain('bg-destructive/10');
  });

  it('각 접근 권한과 계정 상태 그룹에 현재 값이 하나씩 있다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessMutationActions
        detail={detail({
          hasStaffAccess: false,
          hasAdminAccess: true,
        })}
        processingAction={null}
        onRequestAction={() => {}}
      />,
    );

    const trueCount = html.match(/aria-checked="true"/g)?.length ?? 0;
    expect(trueCount).toBe(3);
  });

  it('관리자 접근 허용은 SET_ROLE_ADMIN 액션을 요청한다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ hasAdminAccess: false })}
          processingAction={null}
          onRequestAction={onRequestAction}
        />,
      );
    });

    const adminGroup = container.querySelector(
      '[aria-labelledby="admin-admin-access-control-label"]',
    );
    const allowButton = Array.from(
      adminGroup?.querySelectorAll('button[role="radio"]') ?? [],
    ).find((button) => button.textContent?.includes('허용'));
    expect(allowButton).toBeDefined();
    act(() => {
      allowButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    expect(onRequestAction).toHaveBeenCalledWith('SET_ROLE_ADMIN');
  });

  it('계정 상태 버튼은 기존 SET_STATUS_* 액션을 유지한다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessMutationActions
          detail={detail({ accountStatus: 'ACTIVE' })}
          processingAction={null}
          onRequestAction={onRequestAction}
        />,
      );
    });

    const deactivateButton = Array.from(
      container.querySelectorAll('button[role="radio"]'),
    ).find((button) => button.textContent?.includes('비활성'));
    expect(deactivateButton).toBeDefined();
    act(() => {
      deactivateButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    expect(onRequestAction).toHaveBeenCalledWith('SET_STATUS_DEACTIVATED');
  });
});
