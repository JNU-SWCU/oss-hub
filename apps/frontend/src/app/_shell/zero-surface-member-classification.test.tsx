import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StaffAccessRequest } from '@/features/roles/types';
import type { MemberAccess } from './member-access';

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
    await act(() => {
      root.unmount();
      return Promise.resolve();
    });
    container.remove();
  });

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

    await act(() => {
      root.render(<Probe />);
      return Promise.resolve();
    });
    if (received === null) {
      throw new Error('스냅샷을 읽지 못했다.');
    }
    return received;
  }

  describe('온보딩 상태 기계에 들어간다', () => {
    it('승인 대기 교직원은 미배정으로 분류되고 요청 상태를 싣는다', async () => {
      const state = await snapshot(
        ZERO_SURFACE_STAFF,
        staffAccessRequest({ status: 'PENDING' }),
      );

      expect(state.status).toBe('unassigned');
      expect(state.memberKind).toBe('STAFF');
      expect(state.hasStaffAccess).toBe(false);
      expect(state.staffAccessRequestStatus).toBe('PENDING');
    });

    it('승인 대기 교직원의 목적지는 승인 대기 화면이다', async () => {
      const state = await snapshot(
        ZERO_SURFACE_STAFF,
        staffAccessRequest({ status: 'PENDING' }),
      );

      expect(onboardingPathFor(state.staffAccessRequestStatus)).toBe(
        '/onboarding/pending',
      );
    });

    it.each(['REJECTED', 'REVOKED'] as const)(
      '%s 교직원은 미배정으로 분류되고 역할 선택으로 향한다',
      async (status) => {
        const state = await snapshot(
          ZERO_SURFACE_STAFF,
          staffAccessRequest({
            status,
            decidedAt: '2026-07-31T05:00:00.000Z',
            rejectionReason: status === 'REJECTED' ? '합성 반려 사유' : null,
          }),
        );

        expect(state.status).toBe('unassigned');
        expect(state.memberKind).toBe('STAFF');
        expect(state.staffAccessRequestStatus).toBe(status);
        expect(onboardingPathFor(state.staffAccessRequestStatus)).toBe(
          '/onboarding/role',
        );
      },
    );
  });

  describe('기존 인격은 그대로 배정 상태다', () => {
    it.each(ASSIGNED_PERSONAS)(
      '%s는 여전히 배정 상태이고 온보딩 조회를 하지 않는다',
      async (_label, access) => {
        const state = await snapshot(access, null);

        expect(state.status).toBe('assigned');
        expect(state.memberKind).toBe(access.memberKind);
        expect(state.hasStaffAccess).toBe(access.hasStaffAccess);
        expect(state.hasAdminAccess).toBe(access.hasAdminAccess);

        expect(mocks.fetchMyStaffAccessRequest).not.toHaveBeenCalled();
      },
    );
  });
});
