'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/features/auth/use-session';
import { fetchMyStaffAccessRequest, fetchMyRoleSelection } from '@/features/roles/api';
import type { StaffAccessRequestStatus, RoleSelection } from '@/features/roles/types';
import { EMPTY_MEMBER_ACCESS, type MemberAccess } from './member-access';
import { useOptionalSharedSessionRole } from './session-role-context';

/**
 * `error`는 조회 자체가 실패한 상태다 — 비로그인(`anonymous`)과 반드시 구분한다.
 * 판정 근거는 `features/auth/session-store.ts` 주석에 있다.
 */
export type SessionStatus =
  'loading' | 'error' | 'anonymous' | 'unassigned' | 'assigned';

/**
 * 가입 절차가 남긴 사실이 하나라도 있는가 — 게이트의 `assigned` 판정 근거다.
 *
 * 예전에는 legacy `role !== null` 하나로 물었다. 회원 정체성과 접근 권한이 갈라진
 * 뒤로는 세 칸 중 하나라도 채워져 있으면 이 사람은 온보딩을 지나온 사람이다.
 * 백엔드 `loginLandingUrl`이 같은 규칙으로 착륙 지점을 정한다.
 */
function hasSettledIdentity(user: MemberAccess): boolean {
  return (
    user.memberKind !== null || user.hasStaffAccess || user.hasAdminAccess
  );
}

/**
 * 게이트가 읽고, 게이트 아래 화면이 물려받는 스냅샷.
 *
 * **무엇을 여기 실어도 되는가 — 경계를 적어 둔다.** `staffAccessRequestRejectionReason`이
 * 들어오면서 이 타입은 "접근 판단에 필요한 값"을 넘어 "목적지가 표시할 값"까지 담게
 * 됐다. 그 문이 열린 이상 규칙이 없으면 다음 사람이 계속 얹는다.
 *
 * - **실어도 되는 것**: 서버가 준 **도메인 값**. 역할, 요청 상태, 반려 사유, 고른
 *   역할처럼 "이 사용자에 대한 사실"이다. 게이트가 이미 그 응답을 읽으므로 여기
 *   담는 것이 조회를 아끼고, 판단과 표시가 같은 순간의 답을 보게 한다.
 * - **실으면 안 되는 것**: 화면이 **만들어 내는 것**. 제목·라벨·안내 문구 같은
 *   표시 문자열, JSX, 번역된 문장, 화면별 파생 상태가 그렇다. 그것들은 화면마다
 *   다르고 번역·문안 변경이 이 공용 타입을 흔든다 — 게이트를 쓰는 모든 화면이 함께
 *   끌려온다. 사실만 내려 주고 문장은 화면이 짓는다(`ClosedStaffAccessRequestNotice`가
 *   그 예다: 사유는 여기서 오고, "교직원 요청이 반려되었습니다"는 화면이 만든다).
 */
export interface SessionRoleState extends MemberAccess {
  readonly status: SessionStatus;
  readonly staffAccessRequestStatus: StaffAccessRequestStatus | null;
  /**
   * 관리자가 남긴 반려 사유. `staffAccessRequestStatus === 'REJECTED'`에서만 값이 있다.
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
  readonly staffAccessRequestRejectionReason: string | null;
  /**
   * 가입 절차에서 고른 역할 — 아직 확정되지 않은 선택이다(#569).
   *
   * 확정을 `가입 마치기`로 미룬 뒤, 프로필을 입력하는 동안에는 `role`도
   * `staffAccessRequestStatus`도 비어 있다. 그 구간에서 이 사람이 무엇을 고른 사람인지 아는
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
  ...EMPTY_MEMBER_ACCESS,
  staffAccessRequestStatus: null,
  staffAccessRequestRejectionReason: null,
  selectedRole: null,
  isProfileComplete: false,
};
const ERROR: SessionRoleState = {
  status: 'error',
  ...EMPTY_MEMBER_ACCESS,
  staffAccessRequestStatus: null,
  staffAccessRequestRejectionReason: null,
  selectedRole: null,
  isProfileComplete: false,
};
const ANONYMOUS: SessionRoleState = {
  status: 'anonymous',
  ...EMPTY_MEMBER_ACCESS,
  staffAccessRequestStatus: null,
  staffAccessRequestRejectionReason: null,
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
      /** 같은 브라우저 탭에서 계정이 바뀌어도 이전 사용자의 값을 섞지 않는 키. */
      readonly subject: string;
      readonly status: StaffAccessRequestStatus | null;
      /** 반려 사유. 반려가 아니면 `null`이다 — 표시할 화면이 게이트의 목적지라 함께 싣는다. */
      readonly rejectionReason: string | null;
      readonly selectedRole: RoleSelection | null;
    }
  | { readonly kind: 'failed'; readonly subject: string };

/**
 * 라우트 게이트가 쓰는 세션·역할 상태.
 *
 * 인증 세션은 공유 저장소(`features/auth`)에서 오고, 역할 요청 조회는 여기서
 * 이어 붙인다 — 역할 요청은 `features/roles`에 속하고 feature 간 직접 의존이
 * 금지되어 있어, 두 feature를 함께 쓰는 이 app 계층이 조합을 담당한다.
 */
function useOwnedSessionRole(enabled: boolean): SessionRoleResult {
  const session = useSession();
  const [onboarding, setOnboarding] = useState<OnboardingFetch>({
    kind: 'idle',
  });
  const [refreshGeneration, setRefreshGeneration] = useState(0);

  const onboardingSubject =
    enabled &&
    session.status === 'authenticated' &&
    session.user !== null &&
    !hasSettledIdentity(session.user)
      ? session.user.nickname
      : null;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (onboardingSubject === null) {
      setOnboarding({ kind: 'idle' });
      return;
    }

    let active = true;
    Promise.all([fetchMyStaffAccessRequest(), fetchMyRoleSelection()])
      .then(([request, selection]) => {
        if (active) {
          setOnboarding({
            kind: 'loaded',
            subject: onboardingSubject,
            status: request?.status ?? null,
            // 예전에는 여기서 `status`만 남기고 사유를 버렸다. 그 값을 보여 줄 화면이
            // 바로 이 게이트의 목적지인데(#535·#673), 버리면 그 화면이 같은 것을 다시
            // 물어야 하고 그 두 번째 조회가 실패하면 사유가 사라진다.
            //
            // **반려일 때만 싣는다.** 백엔드는 반려에서만 사유를 기록하지만
            // (`admin-access.repository.ts`), 그 사실에 기대지 않고 여기서 정규화한다 —
            // 불변식을 문서로만 적어 두면 어긋난 응답이 왔을 때 조용히 통과하고, 다음
            // 사람은 상태를 확인하지 않고 이 값을 읽어도 된다고 읽는다.
            rejectionReason:
              request?.status === 'REJECTED'
                ? (request.rejectionReason ?? null)
                : null,
            selectedRole: selection.selectedRole,
          });
        }
      })
      .catch(() => {
        // 조회 실패도 error로 둔다. `unassigned`로 흘리면 이미 승인 대기 중인
        // 사용자에게 역할 선택 화면을 보여주고 중복 요청을 유도하고, 가입 중인
        // 사용자는 고른 역할을 잃은 채 랜딩으로 튕긴다.
        if (active) {
          setOnboarding({ kind: 'failed', subject: onboardingSubject });
        }
      });

    return () => {
      active = false;
    };
  }, [enabled, onboardingSubject, refreshGeneration]);

  const retry = useCallback(() => {
    setOnboarding({ kind: 'idle' });
    // 인증 저장소가 loading을 거쳐 같은 사용자 객체로 돌아오거나 테스트·캐시 계층이
    // 그 중간 렌더를 합쳐도 역할 요청 조회 자체는 반드시 새 세대로 다시 실행한다.
    setRefreshGeneration((current) => current + 1);
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
        const user = session.user;
        if (user === null) return LOADING;
        if (hasSettledIdentity(user)) {
          return {
            status: 'assigned',
            memberKind: user.memberKind,
            hasStaffAccess: user.hasStaffAccess,
            hasAdminAccess: user.hasAdminAccess,
            staffAccessRequestStatus: null,
            staffAccessRequestRejectionReason: null,
            selectedRole: null,
            isProfileComplete: user.isProfileComplete,
          };
        }
        if (onboardingSubject === null) {
          return LOADING;
        }
        switch (onboarding.kind) {
          case 'idle':
            return LOADING;
          case 'failed':
            return onboarding.subject === onboardingSubject ? ERROR : LOADING;
          case 'loaded':
            if (onboarding.subject !== onboardingSubject) {
              return LOADING;
            }
            return {
              status: 'unassigned',
              memberKind: user.memberKind,
              hasStaffAccess: user.hasStaffAccess,
              hasAdminAccess: user.hasAdminAccess,
              staffAccessRequestStatus: onboarding.status,
              staffAccessRequestRejectionReason: onboarding.rejectionReason,
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
  }, [onboarding, onboardingSubject, session.status, session.user]);

  // 게이트가 이 결과를 useEffect 의존성으로 쓰기 때문에 매 렌더 새 객체를 만들면
  // redirect가 무한히 재실행된다.
  return useMemo(() => ({ ...state, retry }), [retry, state]);
}

/**
 * 공통 셸이 이미 만든 스냅샷이 있으면 그것을 그대로 쓴다.
 *
 * 호출부를 모두 다른 훅으로 갈아끼우는 대신 이 오래된 진입점에서 합치는 이유는,
 * 공개 화면·가입 화면·업무 화면이 같은 셸 아래 섞여 있고 일부 컴포넌트는 독립
 * 테스트에서도 렌더되기 때문이다. 훅은 두 갈래 모두 항상 호출하되, 공유 값이 있으면
 * 소유 훅의 네트워크 effect만 끈다. 조건부 훅 호출 없이 최초 요청을 한 곳으로 모은다.
 */
export function useSessionRole(): SessionRoleResult {
  const shared = useOptionalSharedSessionRole();
  const owned = useOwnedSessionRole(shared === null);
  return shared ?? owned;
}
