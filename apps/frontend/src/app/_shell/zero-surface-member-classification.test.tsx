// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StaffAccessRequest } from '@/features/roles/types';
import type { MemberAccess } from './member-access';

/**
 * 면이 하나도 없는 회원을 세션 훅이 어느 쪽으로 분류하는가.
 *
 * 회원 유형(`memberKind`)과 접근 권한(`hasStaffAccess`·`hasAdminAccess`)이 갈린 뒤,
 * **유형은 STAFF인데 권한은 아직·더는 없는** 사람이 생겼다 — 승인을 기다리는
 * 교직원(`PENDING`)과 반려·회수된 교직원(`REJECTED`·`REVOKED`)이다. 그에게
 * `memberSurfaces`는 빈 배열을 돌려주므로 열 수 있는 업무 화면이 하나도 없다.
 *
 * 그 사람을 `assigned`로 분류하면 온보딩 상태 기계 자체에 들어가지 못한다 — 역할
 * 요청 조회가 아예 나가지 않아 `staffAccessRequestStatus`가 비고, 게이트는 보낼 곳을
 * 계산할 근거를 잃는다. 그 분류 하나가 만드는 화면 쪽 결과는
 * `zero-surface-member-reach.test.tsx`가 따로 못 박는다.
 *
 * 여기서는 훅을 **실제로 돌려** 스냅샷을 꺼낸다 — 판단 로직을 테스트에 다시 적으면
 * 잠그는 대상이 제품이 아니라 테스트 자신이 된다.
 */

const mocks = vi.hoisted(() => ({
  fetchMyStaffAccessRequest: vi.fn(),
  fetchMyRoleSelection: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock('@/features/roles/api', () => ({
  fetchMyStaffAccessRequest: mocks.fetchMyStaffAccessRequest,
  fetchMyRoleSelection: mocks.fetchMyRoleSelection,
  selectRole: vi.fn(),
  requestStaffRole: vi.fn(),
}));

vi.mock('@/features/auth/use-session', () => ({
  useSession: mocks.useSession,
}));

import { onboardingPathFor } from './onboarding-route';
import { useSessionRole, type SessionRoleResult } from './use-session-role';
import {
  ASSIGNED_PERSONAS,
  authenticatedSession,
  staffAccessRequest,
  ZERO_SURFACE_STAFF,
} from './zero-surface-member-test-support';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('면이 없는 회원의 분류', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyRoleSelection.mockResolvedValue({ selectedRole: null });
    mocks.fetchMyStaffAccessRequest.mockResolvedValue(null);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /** 훅을 실제로 돌려 스냅샷을 꺼낸다. */
  async function snapshot(
    access: MemberAccess,
    request: StaffAccessRequest | null,
  ): Promise<SessionRoleResult> {
    mocks.useSession.mockReturnValue(authenticatedSession(access));
    mocks.fetchMyStaffAccessRequest.mockResolvedValue(request);
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

  describe('온보딩 상태 기계에 들어간다', () => {
    it('승인 대기 교직원은 미배정으로 분류되고 요청 상태를 싣는다', async () => {
      // Given / When
      const state = await snapshot(
        ZERO_SURFACE_STAFF,
        staffAccessRequest({ status: 'PENDING' }),
      );

      // Then: 유형은 그대로 보존한 채 상태만 미배정이다 — 미배정인 동안에도 이 사람이
      // 무엇으로 신청한 사람인지는 남아야 한다.
      expect(state.status).toBe('unassigned');
      expect(state.memberKind).toBe('STAFF');
      expect(state.hasStaffAccess).toBe(false);
      expect(state.staffAccessRequestStatus).toBe('PENDING');
    });

    it('승인 대기 교직원의 목적지는 승인 대기 화면이다', async () => {
      // Given / When
      const state = await snapshot(
        ZERO_SURFACE_STAFF,
        staffAccessRequest({ status: 'PENDING' }),
      );

      // Then: 목적지는 라우팅 계약이 답한다 — 여기서 문자열을 다시 적지 않는다.
      expect(onboardingPathFor(state.staffAccessRequestStatus)).toBe(
        '/onboarding/pending',
      );
    });

    it.each(['REJECTED', 'REVOKED'] as const)(
      '%s 교직원은 미배정으로 분류되고 역할 선택으로 향한다',
      async (status) => {
        // Given / When
        const state = await snapshot(
          ZERO_SURFACE_STAFF,
          staffAccessRequest({
            status,
            decidedAt: '2026-07-31T05:00:00.000Z',
            rejectionReason: status === 'REJECTED' ? '합성 반려 사유' : null,
          }),
        );

        // Then
        expect(state.status).toBe('unassigned');
        expect(state.memberKind).toBe('STAFF');
        expect(state.staffAccessRequestStatus).toBe(status);
        expect(onboardingPathFor(state.staffAccessRequestStatus)).toBe(
          '/onboarding/role',
        );
      },
    );
  });

  /**
   * 면을 얻는 근거가 셋 다 다른 사람들을 함께 둔다 — 분류가 어느 한 근거로 좁아지는
   * 순간을 잡기 위해서다.
   */
  describe('기존 인격은 그대로 배정 상태다', () => {
    it.each(ASSIGNED_PERSONAS)(
      '%s는 여전히 배정 상태이고 온보딩 조회를 하지 않는다',
      async (_label, access) => {
        // Given / When
        const state = await snapshot(access, null);

        // Then
        expect(state.status).toBe('assigned');
        expect(state.memberKind).toBe(access.memberKind);
        expect(state.hasStaffAccess).toBe(access.hasStaffAccess);
        expect(state.hasAdminAccess).toBe(access.hasAdminAccess);
        // 배정된 사람에게는 역할 요청을 묻지 않는다 — 물으면 온보딩을 이미 지나온
        // 사람에게 매 진입마다 불필요한 조회가 붙는다.
        expect(mocks.fetchMyStaffAccessRequest).not.toHaveBeenCalled();
      },
    );
  });
});
