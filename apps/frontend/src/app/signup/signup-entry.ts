import { ROLE_HOME_LABEL } from '../_shell/role-home-link';
import { roleHomePath } from '../_shell/role';
import { memberSurfaces, type MemberAccess } from '../_shell/member-access';
import type { SessionStatus } from '../_shell/use-session-role';

/**
 * 온보딩 입구. 이미 끝난 단계는 이 화면이 건너뛰고 다음 단계로 전달하므로,
 * 동의·프로필·역할 중 어디서 멈췄든 이 경로 하나로 재개된다
 * (backend `auth/domain/login-landing.ts`가 로그인 직후 보내는 곳과 같다 —
 * 두 곳이 다른 경로를 쓰면 로그인으로 재개할 때와 이 화면으로 재개할 때가
 * 갈라진다).
 */
export const ONBOARDING_ENTRY_PATH = '/consent';

/** GitHub 계정이 없는 방문자가 계정을 만들러 가는 곳. */
export const GITHUB_SIGNUP_URL = 'https://github.com/signup';

export type SignupEntryDecision =
  /** 가입·로그인 안내를 보여 준다. */
  | { readonly kind: 'invite' }
  /** 세션을 아직 모른다 — 안내도 이동도 하지 않는다. */
  | { readonly kind: 'checking' }
  /** 이미 로그인한 사용자 — 멈춘 자리로 되돌린다. */
  | { readonly kind: 'resume'; readonly href: string; readonly label: string };

/**
 * `/signup`에 도착한 방문자를 어떻게 대할지 정한다.
 *
 * 로그인한 사용자에게 가입 권유를 보여 주면 계정이 하나 더 생기는 줄로 읽는다.
 * 그래서 세션이 있으면 안내 대신 원래 가던 자리로 되돌린다 — 온보딩 중이면
 * 온보딩 입구로, 역할이 확정됐으면 역할 홈으로. 목적지 규칙을 여기서 새로 만들지
 * 않고 `roleHomePath`·`ROLE_HOME_LABEL`과 온보딩 입구를 그대로 쓴다.
 *
 * 조회 실패(`error`)는 안내를 보여 주는 쪽으로 둔다. 이 화면의 내용은 세션과
 * 무관한 공개 안내이고, 여기서 오류 화면을 띄우면 **GitHub 계정이 없는 방문자가
 * 다시 갈 곳이 없어진다** — 그 구멍을 막으려고 만든 화면에서 같은 구멍을 다시
 * 낼 이유가 없다. 로그인한 사용자가 이 경우 안내를 보더라도 버튼은 결국 같은
 * OAuth로 이어지고, backend가 그를 원래 자리로 돌려보낸다.
 */
export function signupEntryDecision(
  status: SessionStatus,
  access: MemberAccess,
  isProfileComplete = true,
): SignupEntryDecision {
  switch (status) {
    case 'loading':
      return { kind: 'checking' };
    case 'anonymous':
    case 'error':
      return { kind: 'invite' };
    case 'unassigned':
      return {
        kind: 'resume',
        href: ONBOARDING_ENTRY_PATH,
        label: '이어서 진행하기',
      };
    case 'assigned': {
      // 아무 면도 없는 `assigned`는 세션 훅이 만들지 않는다. 그래도 도달하면
      // 목적지를 지어내는 대신 안내로 떨어뜨린다 — 버튼이 OAuth로 이어지므로
      // 사용자는 어디로든 갈 수 있고, 잘못된 화면으로 밀어내지는 않는다.
      const label = homeLabelFor(access);
      if (label === null) {
        return { kind: 'invite' };
      }
      // 면이 있어도 프로필이 비어 있으면 가입이 아직 안 끝났다. 순서를 유형 →
      // 프로필로 바꾼 뒤 생긴 상태이고, 홈으로 보내면 남은 단계가 화면에서
      // 사라진다 — 이 화면을 만든 이유가 바로 그 구멍을 막기 위해서였다.
      return isProfileComplete
        ? {
            kind: 'resume',
            href: roleHomePath(),
            label: ROLE_HOME_LABEL[label],
          }
        : {
            kind: 'resume',
            href: ONBOARDING_ENTRY_PATH,
            label: '이어서 진행하기',
          };
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * 재개 버튼이 쓸 홈 라벨 — 가장 강한 면 하나를 고른다.
 *
 * 면이 여럿인 사람(학생 관리자 등)에게도 버튼은 하나뿐이라 하나를 골라야 한다.
 * 관리자 → 교직원 → 학생 순서는 `users/domain/authority-label.ts`와 같다.
 */
function homeLabelFor(
  access: MemberAccess,
): 'STUDENT' | 'STAFF' | 'ADMIN' | null {
  const surfaces = memberSurfaces(access);
  if (surfaces.includes('admin')) return 'ADMIN';
  if (surfaces.includes('staff')) return 'STAFF';
  return surfaces.includes('student') ? 'STUDENT' : null;
}
