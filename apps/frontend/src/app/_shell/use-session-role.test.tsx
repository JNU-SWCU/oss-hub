// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoleRequest, RoleRequestStatus } from '@/features/roles/types';

/**
 * 스냅샷이 지키는 불변식.
 *
 * `roleRequestRejectionReason`은 **`REJECTED`에서만 값이 있다**고 타입 주석이 말한다.
 * 그 말이 참인지 여기서 못박는다 — 주석으로만 적어 두면 어긋난 응답이 왔을 때 조용히
 * 통과하고, 다음 사람은 상태를 확인하지 않고 이 값을 읽어도 된다고 읽는다. 지금은
 * 표시 쪽이 상태를 함께 보므로 새어 나가지 않지만, 그 방어가 하나뿐이면 언젠가 샌다.
 */

const mocks = vi.hoisted(() => ({
  fetchMyRoleRequest: vi.fn(),
  fetchMyRoleSelection: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock('@/features/roles/api', () => ({
  fetchMyRoleRequest: mocks.fetchMyRoleRequest,
  fetchMyRoleSelection: mocks.fetchMyRoleSelection,
  selectRole: vi.fn(),
  requestStaffRole: vi.fn(),
}));

vi.mock('@/features/auth/use-session', () => ({
  useSession: mocks.useSession,
}));

import { useSessionRole, type SessionRoleResult } from './use-session-role';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const REASON = '합성 반려 사유';

/** 승인 전 교직원 — 세션에 역할이 없어야 온보딩 조회가 돈다. */
const UNASSIGNED_SESSION = {
  status: 'authenticated' as const,
  user: {
    nickname: 'synthetic-staff-applicant',
    name: '합성 교직원 사용자',
    email: null,
    avatarUrl: null,
    role: null,
    isProfileComplete: true,
  },
  retry: () => {},
};

function roleRequest(overrides: Partial<RoleRequest> = {}): RoleRequest {
  return {
    requestedRole: 'STAFF',
    status: 'PENDING',
    requestedAt: '2026-07-30T02:00:00.000Z',
    decidedAt: null,
    rejectionReason: null,
    ...overrides,
  };
}

describe('useSessionRole — 반려 사유 불변식', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue(UNASSIGNED_SESSION);
    mocks.fetchMyRoleSelection.mockResolvedValue({ selectedRole: null });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /** 훅을 실제로 돌려 스냅샷을 꺼낸다 — 판단 로직을 여기서 다시 적지 않는다. */
  async function snapshot(
    request: RoleRequest | null,
  ): Promise<SessionRoleResult> {
    mocks.fetchMyRoleRequest.mockResolvedValue(request);
    let received: SessionRoleResult | null = null;

    function Probe() {
      received = useSessionRole();
      return null;
    }

    await act(async () => root.render(<Probe />));
    if (received === null) {
      throw new Error('스냅샷을 읽지 못했다.');
    }
    return received;
  }

  it('반려면 사유를 그대로 싣는다', async () => {
    // Given / When
    const state = await snapshot(
      roleRequest({
        status: 'REJECTED',
        decidedAt: '2026-07-31T05:00:00.000Z',
        rejectionReason: REASON,
      }),
    );

    // Then
    expect(state.roleRequestStatus).toBe('REJECTED');
    expect(state.roleRequestRejectionReason).toBe(REASON);
  });

  it('반려인데 사유가 비어 있으면 null이다', async () => {
    // Given / When
    const state = await snapshot(
      roleRequest({
        status: 'REJECTED',
        decidedAt: '2026-07-31T05:00:00.000Z',
        rejectionReason: null,
      }),
    );

    // Then
    expect(state.roleRequestRejectionReason).toBe(null);
  });

  /**
   * 이 검사가 핵심이다. 백엔드는 반려에서만 사유를 기록하지만, 그 사실에 기대지 않고
   * 여기서 정규화한다 — 어긋난 응답이 와도 스냅샷은 불변식을 지켜야 한다.
   */
  it.each([
    ['승인 대기', 'PENDING'],
    ['승인', 'APPROVED'],
    ['회수', 'REVOKED'],
  ] as readonly (readonly [string, RoleRequestStatus])[])(
    '%s 응답에 사유가 실려 와도 스냅샷은 그것을 버린다',
    async (_label, status) => {
      // Given / When: 백엔드가 실수로 사유를 실어 보낸 상황.
      const state = await snapshot(
        roleRequest({ status, rejectionReason: REASON }),
      );

      // Then
      expect(state.roleRequestStatus).toBe(status);
      expect(state.roleRequestRejectionReason).toBe(null);
    },
  );

  it('요청 자체가 없으면 상태도 사유도 없다', async () => {
    // Given / When
    const state = await snapshot(null);

    // Then
    expect(state.roleRequestStatus).toBe(null);
    expect(state.roleRequestRejectionReason).toBe(null);
  });
});
