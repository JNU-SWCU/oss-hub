'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AccessDenied } from './access-denied';
import { onboardingPathFor } from './onboarding-route';
import { SessionError } from './session-error';
import { useSessionRole } from './use-session-role';
import type { SessionRoleState, SessionStatus } from './use-session-role';
import { roleHomePath, type AppRole } from './role';

/**
 * 상태만 보고 이동할 곳을 정한다.
 *
 * `allow`·`deniedPath`를 받지 않는다 — 권한 불일치를 리다이렉트로 처리하던 시절에는
 * 필요했지만, 지금은 불일치를 `AccessDenied` 안내 화면으로 돌리기로 해서 이 판단에
 * 역할 목록이 끼어들 자리가 없다. 인자로 남겨 두면 "여기서도 allow를 본다"고 읽혀
 * 호출부가 없는 값을 계속 나른다.
 */
export function roleGateRedirectPath(state: SessionRoleState): string | null {
  switch (state.status) {
    case 'loading':
      return null;
    // 조회 실패는 어디로도 보내지 않는다. 세션이 살아 있는데 랜딩으로 밀어내면
    // 로그인한 사용자에게 로그아웃된 것처럼 보이고, 역할 홈으로 보내면 권한이
    // 확인되지 않은 상태에서 화면을 열게 된다. 실패는 실패로 드러내고 재시도한다.
    case 'error':
      return null;
    case 'anonymous':
      return '/';
    case 'unassigned':
      return onboardingPathFor(state.roleRequestStatus);
    // 권한 불일치는 더 이상 리다이렉트하지 않는다. 조용히 되돌리면 사용자는
    // 왜 다른 화면이 떠 있는지 알 수 없어 같은 시도를 반복한다. 안내 화면을
    // 띄우고 돌아갈 곳을 직접 고르게 한다(roleGateDeniedHomePath).
    //
    // 다만 프로필이 비어 있으면 온보딩이 아직 끝나지 않은 것이다. 순서를 역할 →
    // 프로필로 바꾼 뒤로 역할 배정이 프로필 완료를 더 이상 요구하지 않아, 프로필
    // 단계에서 창을 닫은 사용자가 역할만 가진 채 업무 화면에 들어올 수 있다.
    // 여기서 되돌리지 않으면 그 계정은 이름·학번 없이 프로그램에 지원하게 된다.
    case 'assigned':
      return state.isProfileComplete ? null : '/onboarding/profile';
    default: {
      const exhaustive: never = state.status;
      return exhaustive;
    }
  }
}

/**
 * 권한 불일치 안내 화면에서 "돌아가기"가 향할 곳.
 * `deniedPath`가 주어지면 그곳, 아니면 자기 역할 홈이다.
 */
export function roleGateDeniedHomePath(
  role: AppRole,
  deniedPath?: string,
): string {
  return deniedPath ?? roleHomePath(role);
}

/** 안내를 읽을 시간. 이만큼 머문 뒤 온보딩으로 이동한다. */
export const UNASSIGNED_NOTICE_DELAY_MS = 2_000;

/**
 * 이동 전에 안내를 먼저 보여줄지.
 *
 * 미배정 사용자만 해당한다 — 이들은 "로그인은 했는데 왜 화면이 바뀌지?" 상태라
 * 이유를 모른 채 튕긴다. 비로그인은 랜딩이 곧 로그인 안내라 지체시킬 이유가 없고,
 * 조회 실패·권한 불일치는 애초에 이동하지 않고 각자의 안내 화면을 띄운다.
 */
export function shouldDelayRedirectForNotice(
  status: SessionStatus,
  hasNotice: boolean,
): boolean {
  return hasNotice && status === 'unassigned';
}

/**
 * 클라이언트 사이드 역할 게이트 (#136 최소 요구 4).
 * - 비로그인: 로그인 유도(랜딩 `/`)로 이동.
 * - 로그인했지만 역할 미확정: `/onboarding/role`(#107)로 이동.
 * - 역할은 확정됐지만 `allow`에 없음: 이동하지 않고 접근 권한 안내를 띄운다.
 * 서버 사이드 강화(middleware)는 이 티켓 범위 밖이다.
 *
 * `unassignedNotice`를 주면 미배정 사용자를 온보딩으로 보내기 직전에 그 안내를
 * 대신 띄운다(#156 설정 화면). 목적지가 아니라 출발지에서 말하는 이유는, 온보딩
 * 화면은 프로필 미완료 같은 사정으로 한 번 더 이동할 수 있어 거기에 붙인 안내는
 * 사라질 수 있기 때문이다.
 */
export function RoleGate({
  allow,
  deniedPath,
  unassignedNotice,
  children,
}: {
  allow: readonly AppRole[];
  deniedPath?: string;
  unassignedNotice?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const state = useSessionRole();
  const { status, role, retry } = state;
  const hasNotice = unassignedNotice !== undefined;

  useEffect(() => {
    const redirectPath = roleGateRedirectPath(state);
    if (!redirectPath) {
      return;
    }
    if (!shouldDelayRedirectForNotice(state.status, hasNotice)) {
      router.replace(redirectPath);
      return;
    }
    const timer = setTimeout(() => {
      router.replace(redirectPath);
    }, UNASSIGNED_NOTICE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, hasNotice, router]);

  const isAllowed =
    status === 'assigned' &&
    !!role &&
    allow.includes(role) &&
    state.isProfileComplete;

  if (status === 'error') {
    return <SessionError onRetry={retry} />;
  }

  // 프로필 미완료는 권한 문제가 아니라 남은 단계다 — 접근 거부 안내를 띄우면
  // 사용자는 자기 화면에서 쫓겨난 것으로 읽는다. 위 리다이렉트에 맡긴다.
  if (
    status === 'assigned' &&
    !!role &&
    state.isProfileComplete &&
    !allow.includes(role)
  ) {
    return <AccessDenied homePath={roleGateDeniedHomePath(role, deniedPath)} />;
  }

  if (shouldDelayRedirectForNotice(status, hasNotice)) {
    return <>{unassignedNotice}</>;
  }

  if (!isAllowed) {
    return (
      <p
        className="flex min-h-[50svh] items-center justify-center px-6 py-16 text-sm text-muted-foreground"
        role="status"
      >
        확인 중…
      </p>
    );
  }

  return <>{children}</>;
}
