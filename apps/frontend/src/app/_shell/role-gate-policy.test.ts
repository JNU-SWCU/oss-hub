import { describe, expect, it, vi } from 'vitest';

import type { StaffAccessRequestStatus } from '@/features/roles/types';
import type { SessionRoleState } from './use-session-role';

// 판단 함수만 불러오지만 모듈이 `next/navigation`을 import한다 — 라우터 컨텍스트
// 밖에서 훅이 실행되지 않도록 여기서도 막아 둔다.
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
  // 회귀 방지: 조회 실패를 anonymous로 접어 넣으면 로그인한 사용자가 랜딩으로
  // 밀려나고 화면상 로그아웃된 것처럼 보인다. 실패는 어디로도 보내지 않는다.
  it('세션 조회 실패는 어디로도 리다이렉트하지 않는다', () => {
    expect(roleGateRedirectPath(state({ status: 'error' }))).toBeNull();
  });

  it('조회 중에는 아직 판단하지 않는다', () => {
    expect(roleGateRedirectPath(state({ status: 'loading' }))).toBeNull();
  });

  // 비로그인도 더 이상 리다이렉트하지 않는다(QA46) — `RoleGate`가 이 자리에
  // 로그인 안내(`LoginRequiredNotice`)를 그대로 띄운다.
  it('비로그인은 어디로도 리다이렉트하지 않는다', () => {
    expect(roleGateRedirectPath(state({ status: 'anonymous' }))).toBeNull();
  });

  // 권한 불일치를 조용히 되돌리면 사용자는 왜 다른 화면이 떠 있는지 모른 채
  // 같은 시도를 반복한다. 이제 이동시키지 않고 안내 화면을 띄운다 — 그래서 이
  // 판단은 어떤 역할이 허용됐는지(`allow`)를 아예 보지 않는다.
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
        state({ status: 'assigned', memberKind: 'STAFF', hasStaffAccess: true, isProfileComplete: false }),
      ),
    ).toBe('/onboarding/profile');
  });

  it.each([
    [null, '/onboarding/role'],
    ['REVOKED', '/onboarding/role'],
    ['PENDING', '/onboarding/pending'],
    ['APPROVED', '/onboarding/pending'],
    // 반려는 살아 있는 신청이 없어 역할부터 다시 고른다(#535).
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

  /**
   * 규칙을 주지 않은 화면(역할 패널 전부)은 종전과 완전히 같아야 한다. 이 갈래가
   * 한 번이라도 열리면 업무 화면이 가입 중인 사용자에게 열린다.
   */
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

  /**
   * 회귀 방지: 화면별 규칙이 실수로 넓어져도 공용 게이트에서 한 번 더 막는다.
   * 비로그인은 남의 프로필을 여는 셈이고, 조회 실패는 "역할이 없음"이 아니라
   * "역할을 모름"이라 화면을 열 근거가 못 된다. loading·assigned는 각자의 처리가
   * 따로 있다.
   */
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

/** 표시 역할 한 단어를 canonical 세 사실로 펼친다. 관리자는 회원 유형을 남기지 않는다. */
function accessFor(role: 'STUDENT' | 'STAFF' | 'ADMIN') {
  return {
    memberKind: role === 'ADMIN' ? null : role,
    hasStaffAccess: role === 'STAFF',
    hasAdminAccess: role === 'ADMIN',
  } as const;
}
