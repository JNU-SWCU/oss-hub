import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppRole } from './role';
import type { SessionStatus } from './use-session-role';

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSessionRole: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
}));
vi.mock('./use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));
// `LoginButton`은 공유 세션 저장소(`features/auth`)를 직접 구독한다 — 이 테스트는
// 역할칩을 붙이는 조립 로직만 검증하면 되므로, 실제 세션 조회 부작용 없이 표식만
// 남기는 대역으로 대체한다.
vi.mock('@/features/auth/components/login-button', () => ({
  LoginButton: () => <div data-testid="login-button">login-button</div>,
}));

import { AccountSlot } from './account-slot';

function mockSession(
  overrides: {
    status?: SessionStatus;
    role?: AppRole | null;
    roleRequestStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
    isProfileComplete?: boolean;
  } = {},
): void {
  const role = overrides.role ?? null;
  mocks.useSessionRole.mockReturnValue({
    status: overrides.status ?? 'assigned',
    role,
    memberKind: role === 'STUDENT' || role === 'STAFF' ? role : null,
    hasStaffAccess: role === 'STAFF',
    hasAdminAccess: role === 'ADMIN',
    roleRequestStatus: overrides.roleRequestStatus ?? null,
    roleRequestRejectionReason: null,
    selectedRole: null,
    isProfileComplete: overrides.isProfileComplete ?? false,
    retry: () => {},
  });
}

describe('AccountSlot', () => {
  it('가입을 마친 학생에게는 recruiting 톤의 "학생" 역할칩을 붙인다', () => {
    mocks.usePathname.mockReturnValue('/programs');
    mockSession({
      status: 'assigned',
      role: 'STUDENT',
      isProfileComplete: true,
    });

    const html = renderToStaticMarkup(<AccountSlot />);

    expect(html).toContain('학생');
    expect(html).toContain('bg-status-recruiting-bg');
    expect(html).toContain('text-status-recruiting-fg');
    expect(html).toContain('aria-label="학생 권한"');
    expect(html).toContain('data-testid="login-button"');
  });

  it('가입을 마친 교직원에게는 approved 톤의 "교직원" 역할칩을 붙인다', () => {
    mocks.usePathname.mockReturnValue('/programs');
    mockSession({ status: 'assigned', role: 'STAFF', isProfileComplete: true });

    const html = renderToStaticMarkup(<AccountSlot />);

    expect(html).toContain('교직원');
    expect(html).toContain('bg-status-approved-bg');
    expect(html).toContain('text-status-approved-fg');
    expect(html).toContain('aria-label="교직원 권한"');
  });

  // PM 결정: ADMIN 전용 색을 새로 만들지 않고 STAFF와 같은 approved 톤을 재사용한다.
  it('관리자에게는 "관리자" 라벨과 교직원과 같은 approved 톤을 쓴다', () => {
    mocks.usePathname.mockReturnValue('/programs');
    mockSession({ status: 'assigned', role: 'ADMIN', isProfileComplete: true });

    const html = renderToStaticMarkup(<AccountSlot />);

    expect(html).toContain('관리자');
    expect(html).toContain('bg-status-approved-bg');
    expect(html).toContain('aria-label="관리자 권한"');
  });

  it('비로그인 상태에서는 역할칩 없이 기존 로그인 진입만 유지한다', () => {
    mocks.usePathname.mockReturnValue('/programs');
    mockSession({ status: 'anonymous', role: null, isProfileComplete: false });

    const html = renderToStaticMarkup(<AccountSlot />);

    expect(html).toContain('data-testid="login-button"');
    expect(html).not.toContain('data-slot="status-badge"');
  });

  // 역할이 배정됐어도 프로필을 마치지 않은 사람은 아직 회원이 아니다
  // (signup-completion.ts) — 역할칩도 그 판단을 그대로 따른다.
  it('역할은 배정됐지만 프로필을 마치지 않은 사용자에게는 역할칩을 붙이지 않는다', () => {
    mocks.usePathname.mockReturnValue('/onboarding/profile');
    mockSession({
      status: 'assigned',
      role: 'STUDENT',
      isProfileComplete: false,
    });

    const html = renderToStaticMarkup(<AccountSlot />);

    expect(html).toContain('data-testid="login-button"');
    expect(html).not.toContain('data-slot="status-badge"');
  });

  // 승인 대기 교직원은 역할이 아직 없어도(`unassigned`) 이미 회원이다
  // (signup-completion.ts) — 하지만 역할칩을 그릴 역할 자체가 없으므로 칩은 안 뜬다.
  it('승인 대기 교직원(unassigned)은 계정 슬롯은 뜨지만 역할칩은 없다', () => {
    mocks.usePathname.mockReturnValue('/programs');
    mockSession({
      status: 'unassigned',
      role: null,
      roleRequestStatus: 'PENDING',
      isProfileComplete: false,
    });

    const html = renderToStaticMarkup(<AccountSlot />);

    expect(html).toContain('data-testid="login-button"');
    expect(html).not.toContain('data-slot="status-badge"');
  });

  it('가입 화면 밖의 미배정 사용자에게는 계정 슬롯 자체를 내지 않는다', () => {
    mocks.usePathname.mockReturnValue('/programs');
    mockSession({ status: 'unassigned', role: null, isProfileComplete: false });

    const html = renderToStaticMarkup(<AccountSlot />);

    expect(html).toBe('');
  });
});
