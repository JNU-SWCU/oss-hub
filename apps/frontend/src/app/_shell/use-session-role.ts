'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/features/auth/use-session';
import { fetchMyRoleRequest, fetchMyRoleSelection } from '@/features/roles/api';
import type { RoleRequestStatus, RoleSelection } from '@/features/roles/types';
import type { AppRole } from './role';

/**
 * `error`는 조회 자체가 실패한 상태다 — 비로그인(`anonymous`)과 반드시 구분한다.
 * 판정 근거는 `features/auth/session-store.ts` 주석에 있다.
 */
export type SessionStatus =
  'loading' | 'error' | 'anonymous' | 'unassigned' | 'assigned';

export interface SessionRoleState {
  readonly status: SessionStatus;
  readonly role: AppRole | null;
  readonly roleRequestStatus: RoleRequestStatus | null;
  /**
   * 관리자가 남긴 반려 사유. `roleRequestStatus === 'REJECTED'`에서만 값이 있다.
   *
   * 이 값이 여기 있는 이유는 **그것을 보여 줄 화면이 게이트의 목적지**이기 때문이다.
   * 반려 사용자는 `/onboarding/role`로 보내지는데(#535), 그 화면이 사유를 직접 다시
   * 조회하면 게이트가 이미 읽은 답을 한 번 더 묻는 셈이고 — 더 나쁘게는 **그 두 번째
   * 조회가 실패하면 게이트는 반려로 판단해 화면을 열어 준 채 화면은 사유 없이
   * 그린다.** 고치려던 결함(#673)이 네트워크가 흔들릴 때마다 되살아나는 것이다.
   * 판단에 쓴 스냅샷이 표시에 필요한 값까지 들고 있어야 그 틈이 없다.
   *
   * 요청이 없거나 반려가 아니면 `null`이다. 회수(`REVOKED`)는 사유를 저장하지 않으므로
   * (`admin-access.repository.ts`의 `decidePendingRequest`) 언제나 `null`이다.
   */
  readonly roleRequestRejectionReason: string | null;
  /**
   * 가입 절차에서 고른 역할 — 아직 확정되지 않은 선택이다(#569).
   *
   * 확정을 `가입 마치기`로 미룬 뒤, 프로필을 입력하는 동안에는 `role`도
   * `roleRequestStatus`도 비어 있다. 그 구간에서 이 사람이 무엇을 고른 사람인지 아는
   * 근거가 이 값뿐이다 — 프로필 화면이 무엇을 물을지, 저장 뒤 어디로 갈지가 여기서
   * 갈린다. 역할이 이미 배정된 사용자(`assigned`)에게는 조회하지 않으므로 `null`이다.
   */
  readonly selectedRole: RoleSelection | null;
  /**
   * 배정된 역할 기준 프로필 완료 여부. `status === 'assigned'`에서만 의미가 있다.
   *
   * 온보딩이 역할 → 프로필 순서라 "역할은 정해졌는데 프로필은 비어 있는" 사용자가
   * 정상적으로 존재한다. `RoleGate`가 그를 프로필 단계로 되돌리는 근거다. 미배정
   * 사용자는 `OnboardingGate`가 프로필을 직접 조회해 판단하므로 여기서는 false로 둔다.
   */
  readonly isProfileComplete: boolean;
}

export interface SessionRoleResult extends SessionRoleState {
  /** `status === 'error'`에서 세션과 역할 요청을 함께 다시 조회한다. */
  retry: () => void;
}

const LOADING: SessionRoleState = {
  status: 'loading',
  role: null,
  roleRequestStatus: null,
  roleRequestRejectionReason: null,
  selectedRole: null,
  isProfileComplete: false,
};
const ERROR: SessionRoleState = {
  status: 'error',
  role: null,
  roleRequestStatus: null,
  roleRequestRejectionReason: null,
  selectedRole: null,
  isProfileComplete: false,
};
const ANONYMOUS: SessionRoleState = {
  status: 'anonymous',
  role: null,
  roleRequestStatus: null,
  roleRequestRejectionReason: null,
  selectedRole: null,
  isProfileComplete: false,
};

/**
 * 미배정 사용자의 온보딩 상태 — 살아 있는 역할 요청과 고른 역할을 함께 읽는다.
 *
 * 둘을 한 번에 담는 이유는 게이트가 둘을 **함께** 봐야 답이 나오기 때문이다. 하나만
 * 도착한 중간 상태를 흘리면, 요청이 없고 선택도 아직 안 온 순간이 "아무것도 고르지
 * 않은 사람"으로 읽혀 가입 중인 사용자가 랜딩으로 튕긴다.
 */
type OnboardingFetch =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'loaded';
      readonly status: RoleRequestStatus | null;
      /** 반려 사유. 반려가 아니면 `null`이다 — 표시할 화면이 게이트의 목적지라 함께 싣는다. */
      readonly rejectionReason: string | null;
      readonly selectedRole: RoleSelection | null;
    }
  | { readonly kind: 'failed' };

/**
 * 라우트 게이트가 쓰는 세션·역할 상태.
 *
 * 인증 세션은 공유 저장소(`features/auth`)에서 오고, 역할 요청 조회는 여기서
 * 이어 붙인다 — 역할 요청은 `features/roles`에 속하고 feature 간 직접 의존이
 * 금지되어 있어, 두 feature를 함께 쓰는 이 app 계층이 조합을 담당한다.
 */
export function useSessionRole(): SessionRoleResult {
  const session = useSession();
  const [onboarding, setOnboarding] = useState<OnboardingFetch>({
    kind: 'idle',
  });

  const needsOnboardingState =
    session.status === 'authenticated' && session.user?.role == null;

  useEffect(() => {
    if (!needsOnboardingState) {
      setOnboarding({ kind: 'idle' });
      return;
    }

    let active = true;
    Promise.all([fetchMyRoleRequest(), fetchMyRoleSelection()])
      .then(([request, selection]) => {
        if (active) {
          setOnboarding({
            kind: 'loaded',
            status: request?.status ?? null,
            // 예전에는 여기서 `status`만 남기고 사유를 버렸다. 그 값을 보여 줄 화면이
            // 바로 이 게이트의 목적지인데(#535·#673), 버리면 그 화면이 같은 것을 다시
            // 물어야 하고 그 두 번째 조회가 실패하면 사유가 사라진다.
            rejectionReason: request?.rejectionReason ?? null,
            selectedRole: selection.selectedRole,
          });
        }
      })
      .catch(() => {
        // 조회 실패도 error로 둔다. `unassigned`로 흘리면 이미 승인 대기 중인
        // 사용자에게 역할 선택 화면을 보여주고 중복 요청을 유도하고, 가입 중인
        // 사용자는 고른 역할을 잃은 채 랜딩으로 튕긴다.
        if (active) {
          setOnboarding({ kind: 'failed' });
        }
      });

    return () => {
      active = false;
    };
  }, [needsOnboardingState]);

  const retry = useCallback(() => {
    setOnboarding({ kind: 'idle' });
    session.retry();
  }, [session]);

  const state = useMemo<SessionRoleState>(() => {
    switch (session.status) {
      case 'loading':
        return LOADING;
      case 'error':
        return ERROR;
      case 'anonymous':
        return ANONYMOUS;
      case 'authenticated': {
        const role = session.user?.role ?? null;
        if (role !== null) {
          return {
            status: 'assigned',
            role,
            roleRequestStatus: null,
            roleRequestRejectionReason: null,
            selectedRole: null,
            isProfileComplete: session.user?.isProfileComplete ?? false,
          };
        }
        switch (onboarding.kind) {
          case 'idle':
            return LOADING;
          case 'failed':
            return ERROR;
          case 'loaded':
            return {
              status: 'unassigned',
              role: null,
              roleRequestStatus: onboarding.status,
              roleRequestRejectionReason: onboarding.rejectionReason,
              selectedRole: onboarding.selectedRole,
              isProfileComplete: false,
            };
          default: {
            const exhaustive: never = onboarding;
            return exhaustive;
          }
        }
      }
      default: {
        const exhaustive: never = session.status;
        return exhaustive;
      }
    }
  }, [onboarding, session.status, session.user]);

  // 게이트가 이 결과를 useEffect 의존성으로 쓰기 때문에 매 렌더 새 객체를 만들면
  // redirect가 무한히 재실행된다.
  return useMemo(() => ({ ...state, retry }), [retry, state]);
}
