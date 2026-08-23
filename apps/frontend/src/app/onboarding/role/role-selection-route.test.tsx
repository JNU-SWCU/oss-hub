// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StaffAccessRequestStatus } from '@/features/roles/types';
import { SessionRoleProvider } from '../../_shell/session-role-context';
import type { SessionRoleResult } from '../../_shell/use-session-role';

/**
 * **게이트가 판단에 쓴 값이 화면까지 도달하는가**(#673).
 *
 * 이 결함의 본체는 사유를 그리는 코드가 없다는 것이 아니었다. 사유는 게이트가 이미
 * 읽고 있었는데(`role-requests/me`), 게이트가 그것을 버리고 화면이 **다시 조회**했다.
 * 그 두 번째 조회는 실패해도 조용히 삼켜졌으므로, 게이트는 반려로 판단해 이 화면을
 * 열어 준 채 화면은 사유 없이 그리는 상태가 성립했다 — 네트워크가 한 번 흔들릴
 * 때마다 고친 결함이 되살아나는 구조였다.
 *
 * 그래서 여기서 못박는 계약은 둘이다.
 *
 * 1. 스냅샷이 `REJECTED` + 사유를 들고 있으면 화면에 그 사유가 **실제로** 나타난다.
 * 2. 그러기 위해 이 경계는 **아무것도 조회하지 않는다.** 조회가 하나라도 나가면
 *    화면이 그리는 근거와 게이트가 연 근거가 다시 갈라질 수 있다.
 *
 * 실제 라우팅까지 통과시키는 검사는 `app/_shell/onboarding-rejection-reach.test.tsx`가
 * 따로 갖는다. 이 파일은 그 사이의 배선 한 칸만 본다.
 */

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

  /** 이번 blocker의 본체 — 게이트가 반려로 판단했는데 화면이 사유를 못 받으면 실패한다. */
  it('스냅샷의 반려 사유가 화면에 그대로 도달한다', async () => {
    // Given / When
    const text = await render(
      snapshot({
        staffAccessRequestStatus: 'REJECTED',
        staffAccessRequestRejectionReason: REASON,
      }),
    );

    // Then
    expect(text).toContain(HEADLINE);
    expect(text).toContain(REASON);
  });

  /**
   * 화면은 스스로 묻지 않는다. 이 단언이 없으면 누군가 "안전하게 한 번 더 읽자"며
   * 조회를 되살려도 위 검사는 그대로 통과한다 — 그 재조회가 정확히 이 결함이었다.
   */
  it('사유를 얻으려고 아무것도 조회하지 않는다', async () => {
    // Given / When
    await render(
      snapshot({
        staffAccessRequestStatus: 'REJECTED',
        staffAccessRequestRejectionReason: REASON,
      }),
    );

    // Then
    expect(mocks.fetchMyStaffAccessRequest).not.toHaveBeenCalled();
    expect(mocks.fetchMyRoleSelection).not.toHaveBeenCalled();
  });

  /** 게이트가 이미 읽어 둔 선택도 같은 경로로 온다 — 되살리기에도 조회가 필요 없다(#569). */
  it('스냅샷의 고른 역할이 고른 상태로 도달한다', async () => {
    // Given / When
    await render(snapshot({ selectedRole: 'STAFF' }));

    // Then
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
    // 회수는 사유를 저장하지 않는다 — 안내 대상이 아니다.
    ['회수', 'REVOKED'],
  ] as readonly (readonly [string, StaffAccessRequestStatus | null])[])(
    '%s 스냅샷에는 반려 안내를 그리지 않는다',
    async (_label, staffAccessRequestStatus) => {
      // Given / When: 사유가 실려 와도 상태가 반려가 아니면 그리지 않는다.
      const text = await render(
        snapshot({
          staffAccessRequestStatus,
          staffAccessRequestRejectionReason: REASON,
        }),
      );

      // Then
      expect(text).not.toContain(HEADLINE);
      expect(text).not.toContain(REASON);
    },
  );

  /** 사유 없이 닫힌 과거 반려 건 — 사실은 남고 빈 사유 상자는 그리지 않는다. */
  it('사유가 없는 반려도 사실은 알린다', async () => {
    // Given / When
    const text = await render(
      snapshot({
        staffAccessRequestStatus: 'REJECTED',
        staffAccessRequestRejectionReason: null,
      }),
    );

    // Then
    expect(text).toContain(HEADLINE);
    expect(text).not.toContain('반려 사유');
  });
});
