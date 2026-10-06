import { describe, expect, it, vi } from 'vitest';

import type { StaffAccessRequestStatus } from '@/features/roles/types';
import type { SessionRoleState } from './use-session-role';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

import {
  roleGateDeniedHomePath,
  roleGateRedirectPath,
  shouldOpenForUnassigned,
  type UnassignedAccessPolicy,
} from './role-gate';

function state(overrides: Partial<SessionRoleState> = {}): SessionRoleState {
  return {
    status: 'loading',
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    staffAccessRequestStatus: null,
    staffAccessRequestRejectionReason: null,
    selectedRole: null,
    isProfileComplete: false,
    ...overrides,
  };
}

const OPEN: UnassignedAccessPolicy = () => true;
const CLOSED: UnassignedAccessPolicy = () => false;

describe('roleGateRedirectPath', () => {
  it('세션 조회 실패는 어디로도 리다이렉트하지 않는다', () => {
    expect(roleGateRedirectPath(state({ status: 'error' }))).toBeNull();
  });

  it('조회 중에는 아직 판단하지 않는다', () => {
    expect(roleGateRedirectPath(state({ status: 'loading' }))).toBeNull();
  });

  it('비로그인은 어디로도 리다이렉트하지 않는다', () => {
    expect(roleGateRedirectPath(state({ status: 'anonymous' }))).toBeNull();
  });

  it.each(['STUDENT', 'STAFF', 'ADMIN'] as const)(
    '역할이 배정되고 프로필까지 마친 %s는 허용 목록과 무관하게 이동시키지 않는다',
    (role) => {
      expect(
        roleGateRedirectPath(
          state({
            status: 'assigned',
            ...accessFor(role),
            isProfileComplete: true,
          }),
        ),
      ).toBeNull();
    },
  );

  it('역할은 있지만 프로필이 비어 있으면 프로필 단계로 되돌린다', () => {
    expect(
      roleGateRedirectPath(
        state({
          status: 'assigned',
          memberKind: 'STAFF',
          hasStaffAccess: true,
          isProfileComplete: false,
        }),
      ),
    ).toBe('/onboarding/profile');
  });

  it.each([
    [null, '/onboarding/role'],
    ['REVOKED', '/onboarding/role'],
    ['PENDING', '/onboarding/pending'],
    ['APPROVED', '/onboarding/pending'],

    ['REJECTED', '/onboarding/role'],
  ] as readonly (readonly [StaffAccessRequestStatus | null, string])[])(
    '%s 미배정 사용자의 온보딩 목적지는 %s 다',
    (staffAccessRequestStatus, path) => {
      expect(
        roleGateRedirectPath(
          state({ status: 'unassigned', staffAccessRequestStatus }),
        ),
      ).toBe(path);
    },
  );
});

describe('roleGateDeniedHomePath', () => {
  it('안내 화면의 돌아가기는 deniedPath를, 없으면 회원 공통 대시보드 입구를 가리킨다', () => {
    expect(roleGateDeniedHomePath('/programs')).toBe('/programs');
    expect(roleGateDeniedHomePath()).toBe('/dashboard');
  });
});

describe('shouldOpenForUnassigned', () => {
  it('규칙이 인정한 미배정 사용자에게는 화면을 연다', () => {
    expect(shouldOpenForUnassigned(state({ status: 'unassigned' }), OPEN)).toBe(
      true,
    );
  });

  it('규칙을 주지 않은 화면은 미배정 사용자를 열어 주지 않는다', () => {
    expect(
      shouldOpenForUnassigned(state({ status: 'unassigned' }), undefined),
    ).toBe(false);
  });

  it('규칙이 거절하면 열어 주지 않는다', () => {
    expect(
      shouldOpenForUnassigned(state({ status: 'unassigned' }), CLOSED),
    ).toBe(false);
  });

  it.each(['anonymous', 'loading', 'error', 'assigned'] as const)(
    '%s 상태는 규칙이 무엇이라 하든 열어 주지 않는다',
    (status) => {
      expect(shouldOpenForUnassigned(state({ status }), OPEN)).toBe(false);
    },
  );

  it('규칙에는 상태 전체를 넘긴다 — 역할 요청까지 보고 갈래를 가릴 수 있어야 한다', () => {
    const seen: SessionRoleState[] = [];
    const given = state({
      status: 'unassigned',
      staffAccessRequestStatus: 'PENDING',
      selectedRole: 'STAFF',
    });

    shouldOpenForUnassigned(given, (value) => {
      seen.push(value);
      return true;
    });

    expect(seen).toEqual([given]);
  });
});

function accessFor(role: 'STUDENT' | 'STAFF' | 'ADMIN') {
  return {
    memberKind: role === 'ADMIN' ? null : role,
    hasStaffAccess: role === 'STAFF',
    hasAdminAccess: role === 'ADMIN',
  } as const;
}
