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
    approvalStatus: 'NOT_REQUIRED',
    approvalRequestId: null,
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

function resetButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === '가입 유형 되돌리기',
  );
  if (!button) throw new TypeError('Reset button missing');
  return button;
}
describe('membership correction controls', () => {
  it.each(['STUDENT', 'STAFF'] as const)(
    'shows %s as read-only and keeps only authority and status selectors',
    (memberKind) => {
      render(detail({ memberKind }));
      expect(
        container.querySelector('#admin-member-kind-control')?.textContent,
      ).toBe(memberKind === 'STUDENT' ? '학생' : '교직원');
      expect(
        container
          .querySelector('#admin-member-kind-control')
          ?.getAttribute('role'),
      ).not.toBe('combobox');
      expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(2);
    },
  );
  it('requests only registration reset from the destructive action', () => {
    const request = render(detail());
    act(() => resetButton().click());
    expect(request).toHaveBeenCalledExactlyOnceWith('RESET_MEMBER_KIND');
    expect(resetButton().dataset.variant).toBe('destructive');
  });
  it.each([
    { isSelf: true },
    { memberKind: null },
    { hasAdminAccess: true },
  ] as const)('disables reset with a visible reason for %j', (overrides) => {
    const request = render(detail(overrides));
    expect(resetButton().disabled).toBe(true);
    const descriptionId = resetButton().getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(
      document.getElementById(descriptionId ?? '')?.textContent?.trim(),
    ).toBeTruthy();
    act(() => resetButton().click());
    expect(request).not.toHaveBeenCalled();
  });
  it('allows resetting incomplete and pending registrations', () => {
    render(
      detail({
        isProfileComplete: false,
        pendingRequest: {
          id: 'request',
          status: 'PENDING',
          createdAt: '2026-01-01',
        },
      }),
    );
    expect(resetButton().disabled).toBe(false);
  });
});
