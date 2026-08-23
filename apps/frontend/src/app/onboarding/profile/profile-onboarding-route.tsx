'use client';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ProfileOnboardingScreen } from '@/features/profile/components/profile-onboarding-screen';
import type { ProfileMemberKind } from '@/features/profile/profile-requirements';
import {
  isClosedStaffAccessRequest,
  onboardingPathFor,
} from '../../_shell/onboarding-route';
import { roleHomePath } from '../../_shell/role';
import { SessionError } from '../../_shell/session-error';
import {
  useSessionRole,
  type SessionRoleState,
} from '../../_shell/use-session-role';

type ProfileOnboardingState = SessionRoleState;

/** 아직 가입을 마치지 않은 사용자를 되돌릴 자리 — `AuthGate`가 비로그인을 보내는 곳과 같다. */
const LANDING_PATH = '/';

/** 역할 선택으로 되돌아가는 자리 — 아직 확정되지 않은 사용자만 쓸 수 있다(#569). */
const ROLE_PATH = '/onboarding/role';

export type ProfileOnboardingView =
  | { readonly kind: 'pending' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'redirect';
      readonly path: typeof LANDING_PATH | typeof ROLE_PATH;
    }
  | {
      readonly kind: 'form';
      readonly memberKind: ProfileMemberKind;
      readonly nextPath: string;
      /**
       * 역할 선택으로 되돌아갈 수 있는가.
       *
       * 확정 전에만 참이다. 되돌아가는 일은 기록한 선택을 바꾸는 것뿐이라 회수·해제가
       * 필요 없지만, 확정된 뒤에는 그렇지 않다 — 승인을 기다리는 교직원이 되돌아가면
       * 백엔드가 409로 막고(`ROL_003`) 사용자는 이유를 알 수 없는 오류만 본다.
       */
      readonly canChangeRole: boolean;
    };

/**
 * 가입을 마친 뒤 도착할 곳.
 *
 * 확정을 `가입 마치기`로 미룬 뒤로, **저장이 끝나야 비로소 역할이 생긴다**(#569).
 * 그래서 목적지를 지금 세션의 역할로 정할 수 없다 — 학생은 저장 직후 STUDENT가 되고
 * 교직원은 승인 대기가 된다. 무엇이 될 사람인지 아는 근거가 고른 역할이다.
 *
 * 이미 확정된 사용자(`role`)는 그 역할 홈으로 간다. 둘 다 없으면 기존 판단
 * (`onboardingPathFor`)에 맡긴다 — 반려·회수처럼 선택이 아니라 이력이 목적지를
 * 정하는 상태들이다.
 */
export function signupDestination(state: ProfileOnboardingState): string {
  if (state.memberKind !== null) {
    return '/dashboard';
  }
  if (state.hasAdminAccess) {
    return '/admin/access';
  }
  if (state.role) return roleHomePath(state.role);
  switch (state.selectedRole) {
    case 'STUDENT':
      return roleHomePath('STUDENT');
    case 'STAFF':
      return '/onboarding/pending';
    case null:
      return onboardingPathFor(state.staffAccessRequestStatus);
  }
}

/**
 * 세션·역할 상태를 프로필 화면의 표시 결정으로 바꾼다.
 *
 * 역할이 확정되기 전에는 폼을 만들지 않는다. `role`도 `staffAccessRequestStatus`도 아직
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
 * `role`이 비어 있어도 역할을 이미 골랐고 프로필을 반드시 채워야 한다. 확정을
 * `가입 마치기`로 미룬 뒤로는(#569) **프로필을 처음 채우는 사람도 그 상태다** — 역할도
 * 요청도 없고 고른 기록만 있다. 그래서 판정은 "고른 흔적이 하나도 없는가"로 한다:
 * 살아 있는 요청도 없고(`staffAccessRequestStatus === null`) 고른 역할도 없을 때만 되돌린다.
 *
 * 되돌리는 범위는 딱 그 하나다. 회수(`REVOKED`)·반려(`REJECTED`)는 역할을 고르긴 고른
 * 사용자라 여기서 함께 묶지 않고 기존 경로를 그대로 둔다 — 그 상태들의 처리는
 * `onboardingPathFor`가 이미 정해 두었고, 바꾸려면 그 계약을 함께 갱신해야 한다.
 *
 * 비로그인은 바깥 `AuthGate`가 랜딩으로 되돌린다 — 여기서는 그 이동이 일어날 때까지
 * 폼을 그리지 않고 기다리기만 하면 된다.
 */
function profileMemberKind(
  state: ProfileOnboardingState,
): ProfileMemberKind | null {
  if (state.memberKind !== null) return state.memberKind;
  if (state.selectedRole !== null) return state.selectedRole;
  return state.staffAccessRequestStatus === 'PENDING' ||
    state.staffAccessRequestStatus === 'APPROVED'
    ? 'STAFF'
    : null;
}

export function profileOnboardingView(
  state: ProfileOnboardingState,
): ProfileOnboardingView {
  switch (state.status) {
    case 'loading':
    case 'anonymous':
      return { kind: 'pending' };
    case 'error':
      return { kind: 'error' };
    case 'unassigned':
    case 'assigned':
      // `assigned`는 세션에 역할이 붙은 사용자다. 그쪽의 `staffAccessRequestStatus`·
      // `selectedRole`은 조회하지 않아 항상 null이므로 상태를 함께 봐야 배정된
      // 사용자를 되돌리지 않는다.
      if (
        state.status === 'unassigned' &&
        state.staffAccessRequestStatus === null &&
        state.selectedRole === null
      ) {
        return { kind: 'redirect', path: LANDING_PATH };
      }

      // 회수·반려는 살아 있는 신청이 없는 상태라 역할부터 다시 고른다(#535).
      //
      // 여기서 폼을 그리면 역할을 모르는 채로 가장 엄격한 학생 기준이 적용돼
      // 학번을 필수로 묻는다. 교직원이었다가 회수된 사람에게는 학번이 없어
      // 지어내야 하고, 한 번 저장하면 백엔드가 그 값을 잠근다(`USR_003`).
      // `onboardingPathFor`는 이미 이 두 상태를 역할 선택으로 보내고 있었다 —
      // 화면만 그 계약을 따르지 않고 있었다.
      if (
        state.status === 'unassigned' &&
        isClosedStaffAccessRequest(state.staffAccessRequestStatus)
      ) {
        return { kind: 'redirect', path: ROLE_PATH };
      }

      const memberKind = profileMemberKind(state);
      if (memberKind === null) {
        return { kind: 'redirect', path: ROLE_PATH };
      }
      return {
        kind: 'form',
        memberKind,
        nextPath: signupDestination(state),
        // 확정된 것이 하나도 없을 때만 되돌아갈 수 있다.
        canChangeRole:
          state.status === 'unassigned' && state.staffAccessRequestStatus === null,
      };
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
 *
 * 이동은 `redirect()`로 렌더 도중 끝낸다. 조회가 끝난 시점에 이미 확정된 이동이라
 * `useRouter` + `useEffect`로 한 번 그린 뒤 미루면, 이동을 기다리는 화면 하나를
 * 더 만들어야 하고 그 화면이 폼을 그리지 않는다는 것도 따로 지켜야 한다.
 */
export function ProfileOnboardingRoute() {
  const state = useSessionRole();
  const view = profileOnboardingView(state);

  if (view.kind === 'error') {
    return <SessionError onRetry={state.retry} />;
  }

  if (view.kind === 'redirect') {
    redirect(view.path);
  }

  // 바깥 `AuthGate`와 같은 대기 표시를 쓴다. 한 라우트 안에서 문구가 바뀌면 사용자는
  // 화면이 한 번 더 넘어간 것으로 읽는다.
  if (view.kind === 'pending') {
    return (
      <p
        className="flex min-h-[50svh] items-center justify-center px-6 py-16 text-sm text-muted-foreground"
        role="status"
      >
        확인 중…
      </p>
    );
  }

  return (
    <>
      <ProfileOnboardingScreen
        memberKind={view.memberKind}
        nextPath={view.nextPath}
      />
      {view.canChangeRole ? <ChangeRoleLink /> : null}
    </>
  );
}

/**
 * 역할 선택으로 되돌아가는 링크(#569).
 *
 * 예전에는 이 화면에서 역할 선택으로 돌아갈 방법이 하나도 없었다 — 본문에 링크가 없고,
 * 주소로 `/onboarding/role`을 쳐도 게이트가 프로필로 되돌렸다. 역할이 이미 확정된
 * 뒤라서 그랬다. 확정을 `가입 마치기`로 미룬 지금은 되돌아가도 되고, 되돌아가서 하는
 * 일은 기록한 선택을 바꾸는 것뿐이라 취소할 요청도 되돌릴 역할도 없다.
 *
 * 화면 컴포넌트(`features/profile`)가 아니라 여기 있는 이유는 "되돌아가도 되는가"가
 * 세션·역할 요청을 봐야 나오는 답이고, 그것을 아는 계층이 app이기 때문이다. 무대의
 * 본문이 세로 flex(`gap-8`)라 이 링크는 폼 아래 한 칸 띄워 선다.
 */
function ChangeRoleLink() {
  return (
    <p className="text-small text-cosmos-muted">
      <Link
        href={ROLE_PATH}
        className="underline underline-offset-4 hover:text-cosmos-copy"
      >
        역할을 다시 고르기
      </Link>
      {' — 아직 확정되지 않았습니다.'}
    </p>
  );
}
