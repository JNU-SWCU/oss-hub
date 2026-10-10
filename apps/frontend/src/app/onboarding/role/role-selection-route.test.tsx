import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StaffAccessRequestStatus } from '@/features/roles/types';
import { SessionRoleProvider } from '../../_shell/session-role-context';
import type { SessionRoleResult } from '../../_shell/use-session-role';

const mocks = vi.hoisted(() => ({
  fetchMyStaffAccessRequest: vi.fn(),
  fetchMyRoleSelection: vi.fn(),
  selectRole: vi.fn(),
}));

vi.mock('@/features/roles/api', () => ({
  fetchMyStaffAccessRequest: mocks.fetchMyStaffAccessRequest,
  fetchMyRoleSelection: mocks.fetchMyRoleSelection,
  selectRole: mocks.selectRole,
  requestStaffRole: vi.fn(),
}));

import { RoleSelectionRoute } from './role-selection-route';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const REASON = '합성 반려 사유 — 소속 학과가 확인되지 않았습니다.';
const HEADLINE = '교직원 요청이 반려되었습니다';

function snapshot(
  overrides: Partial<SessionRoleResult> = {},
): SessionRoleResult {
  return {
    status: 'unassigned',
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    staffAccessRequestStatus: null,
    staffAccessRequestRejectionReason: null,
    selectedRole: null,
    isProfileComplete: false,
    retry: () => {},
    ...overrides,
  };
}

describe('역할 선택 라우트 — 게이트 스냅샷 배선', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(value: SessionRoleResult): Promise<string> {
    await act(async () =>
      root.render(
        <SessionRoleProvider value={value}>
          <RoleSelectionRoute />
        </SessionRoleProvider>,
      ),
    );
    return container.textContent ?? '';
  }

  it('스냅샷의 반려 사유가 화면에 그대로 도달한다', async () => {
    const text = await render(
      snapshot({
        staffAccessRequestStatus: 'REJECTED',
        staffAccessRequestRejectionReason: REASON,
      }),
    );

    expect(text).toContain(HEADLINE);
    expect(text).toContain(REASON);
  });

  it('사유를 얻으려고 아무것도 조회하지 않는다', async () => {
    await render(
      snapshot({
        staffAccessRequestStatus: 'REJECTED',
        staffAccessRequestRejectionReason: REASON,
      }),
    );

    expect(mocks.fetchMyStaffAccessRequest).not.toHaveBeenCalled();
    expect(mocks.fetchMyRoleSelection).not.toHaveBeenCalled();
  });

  it('스냅샷의 고른 역할이 고른 상태로 도달한다', async () => {
    await render(snapshot({ selectedRole: 'STAFF' }));

    const staffInput = container.querySelector<HTMLInputElement>(
      'input[value="STAFF"]',
    );
    expect(staffInput?.checked).toBe(true);
    expect(mocks.fetchMyRoleSelection).not.toHaveBeenCalled();
  });

  it.each([
    ['요청 없음', null],
    ['승인 대기', 'PENDING'],
    ['승인', 'APPROVED'],

    ['회수', 'REVOKED'],
  ] as readonly (readonly [string, StaffAccessRequestStatus | null])[])(
    '%s 스냅샷에는 반려 안내를 그리지 않는다',
    async (_label, staffAccessRequestStatus) => {
      const text = await render(
        snapshot({
          staffAccessRequestStatus,
          staffAccessRequestRejectionReason: REASON,
        }),
      );

      expect(text).not.toContain(HEADLINE);
      expect(text).not.toContain(REASON);
    },
  );

  it('사유가 없는 반려도 사실은 알린다', async () => {
    const text = await render(
      snapshot({
        staffAccessRequestStatus: 'REJECTED',
        staffAccessRequestRejectionReason: null,
      }),
    );

    expect(text).toContain(HEADLINE);
    expect(text).not.toContain('반려 사유');
  });
});
