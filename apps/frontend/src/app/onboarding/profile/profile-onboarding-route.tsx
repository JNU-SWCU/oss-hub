'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ProfileOnboardingScreen } from '@/features/profile/components/profile-onboarding-screen';
import type { ProfileRole } from '@/features/profile/profile-requirements';
import {
  effectiveProfileRole,
  onboardingPathFor,
} from '../../_shell/onboarding-route';
import { roleHomePath } from '../../_shell/role';
import { SessionError } from '../../_shell/session-error';
import {
  useSessionRole,
  type SessionRoleState,
} from '../../_shell/use-session-role';

/** 아직 가입을 마치지 않은 사용자를 되돌릴 자리 — `AuthGate`가 비로그인을 보내는 곳과 같다. */
const LANDING_PATH = '/';

export type ProfileOnboardingView =
  | { readonly kind: 'pending' }
  | { readonly kind: 'error' }
  | { readonly kind: 'redirect'; readonly path: typeof LANDING_PATH }
  | {
      readonly kind: 'form';
      readonly role: ProfileRole | null;
      readonly nextPath: string;
    };

/**
 * 세션·역할 상태를 프로필 화면의 표시 결정으로 바꾼다.
 *
 * 역할이 확정되기 전에는 폼을 만들지 않는다. `role`도 `roleRequestStatus`도 아직
 * 비어 있는 조회 중 상태를 그대로 넘기면 `effectiveProfileRole`이 null을 돌려주고,
 * 화면은 그것을 가장 엄격한 학생 기준으로 읽는다 — 승인을 기다리는 교직원에게 잠깐
 * 학번 필수 폼이 뜨고, `nextPath`도 역할 홈이 아니라 `/onboarding/role`을 가리킨다.
 * 무엇을 물을지와 어디로 보낼지는 조회가 끝난 뒤에야 정해진다.
 *
 * 조회 실패도 폼으로 흘리지 않는다. 실패는 "역할이 없음"이 아니라 "역할을 모름"이라
 * 학생 기준으로 되돌리면 위와 같은 오진을 그대로 저지른다. 다른 게이트들과 같이
 * `SessionError`로 드러내고 재시도 수단을 준다.
 *
 * 아직 역할을 고르지 않은 사용자는 폼을 아예 열지 않고 랜딩으로 되돌린다(#493). 역할을
 * 고르지 않았다는 것은 가입을 마치지 않았다는 뜻이고, 가입을 마치지 않은 사람은 비회원과
 * 같은 화면을 봐야 한다 — 비로그인을 `AuthGate`가 되돌리는 그 자리로 함께 보낸다.
 * 폼을 열어 주면 학생 기준으로 그려져 교직원이 가짜 학번을 지어내야 넘어가고, 저장하면
 * 백엔드가 그 학번을 잠가(`USR_003 STUDENT_ID_IMMUTABLE`) 다시 고칠 기회가 없어진다 —
 * 단계 순서를 약관 → 역할 → 프로필로 뒤집어 없앴다고 한 바로 그 실패다.
 *
 * 다만 "역할이 없다"와 "세션에 역할이 아직 안 붙었다"는 다르다. 승인을 기다리는 교직원은
 * `role`이 비어 있어도 역할을 이미 골랐고 프로필을 반드시 채워야 한다. 그래서 판정은
 * `role`이 아니라 역할 요청 상태로 하고, 그 분류는 `onboardingPathFor`에 맡긴다 —
 * 그 함수가 `/onboarding/role`을 가리키는 상태(요청 없음·회수됨)가 곧 "역할을 다시
 * 골라야 하는 사람"이다. 여기서 목록을 따로 적으면 두 곳이 갈라진다.
 *
 * 비로그인은 바깥 `AuthGate`가 랜딩으로 되돌린다 — 여기서는 그 이동이 일어날 때까지
 * 폼을 그리지 않고 기다리기만 하면 된다.
 */
export function profileOnboardingView(
  state: SessionRoleState,
): ProfileOnboardingView {
  switch (state.status) {
    case 'loading':
    case 'anonymous':
      return { kind: 'pending' };
    case 'error':
      return { kind: 'error' };
    case 'unassigned':
    case 'assigned': {
      const nextPath = state.role
        ? roleHomePath(state.role)
        : onboardingPathFor(state.roleRequestStatus);

      if (nextPath === '/onboarding/role') {
        return { kind: 'redirect', path: LANDING_PATH };
      }

      return {
        kind: 'form',
        role: effectiveProfileRole(state.role, state.roleRequestStatus),
        nextPath,
      };
    }
    default: {
      const exhaustive: never = state.status;
      return exhaustive;
    }
  }
}

/**
 * 세션 역할을 프로필 화면으로 넘기는 얇은 경계.
 *
 * `features/profile`은 `features/auth`·`features/roles`에 직접 의존할 수 없으므로
 * (feature 경계 lint) 두 feature를 함께 쓰는 이 app 계층이 조합을 담당한다.
 *
 * 순서를 약관 → 역할 → 프로필로 바꾼 뒤로 이 화면에서는 역할이 이미 정해져 있다.
 * 다만 교직원은 승인 전까지 세션의 `role`이 비어 있으므로, 살아 있는 교직원 요청을
 * 역할로 인정해야 학번을 요구하지 않는다(`effectiveProfileRole`). 그래서 배정된
 * 역할만 보는 `useSession` 대신 역할 요청까지 아는 `useSessionRole`을 쓴다.
 *
 * 저장 뒤 목적지도 여기서 정한다 — 역할이 확정된 사용자는 자기 역할 홈으로, 승인을
 * 기다리는 교직원은 `onboardingPathFor`가 가리키는 승인 대기 화면으로 간다.
 *
 * 바깥 `AuthGate`가 이미 통과시킨 뒤라도 이 훅은 여기서 새로 마운트되어 역할 요청
 * 조회를 처음부터 다시 한다 — 게이트를 지났다고 이 자리의 역할이 확정된 것은 아니다.
 * 그래서 loading·error를 여기서도 직접 소진한다(`profileOnboardingView`).
 *
 * 역할을 고르지 않은 사용자를 랜딩으로 되돌리는 것도 여기서 한다. `AuthGate`는 로그인만
 * 보는 공용 게이트라 다른 화면 전부가 함께 쓰고, 거기에 역할 조건을 넣으면 파급이 이
 * 화면 밖으로 나간다.
 */
export function ProfileOnboardingRoute() {
  const router = useRouter();
  const state = useSessionRole();
  const view = profileOnboardingView(state);
  const redirectPath = view.kind === 'redirect' ? view.path : null;

  useEffect(() => {
    if (redirectPath !== null) {
      router.replace(redirectPath);
    }
  }, [redirectPath, router]);

  if (view.kind === 'error') {
    return <SessionError onRetry={state.retry} />;
  }

  // 바깥 `AuthGate`와 같은 대기 표시를 쓴다. 한 라우트 안에서 문구가 바뀌면 사용자는
  // 화면이 한 번 더 넘어간 것으로 읽는다. 되돌리는 중에도 같은 표시를 쓴다 — 이동이
  // 끝날 때까지 프로필 폼이 한 번도 그려지지 않아야 한다.
  if (view.kind === 'pending' || view.kind === 'redirect') {
    return (
      <p
        className="flex min-h-[50svh] items-center justify-center px-6 py-16 text-sm text-muted-foreground"
        role="status"
      >
        확인 중…
      </p>
    );
  }

  return <ProfileOnboardingScreen role={view.role} nextPath={view.nextPath} />;
}
