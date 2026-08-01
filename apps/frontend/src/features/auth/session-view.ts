import type { AuthSessionState } from './session-store';
import type { AuthSession } from './types';

/**
 * 공유 인증 상태를 계정 메뉴가 쓰는 형태로 바꾼다.
 *
 * `null`은 "아직 표시할 것이 없다"는 뜻이고 계정 메뉴는 아무것도 렌더하지 않는다.
 * `loading`과 `error`를 모두 `null`로 접는 것이 핵심이다 — 조회 실패를 비로그인으로
 * 표시하면 본문 게이트가 오류와 재시도를 보여주는 동안 헤더는 "회원가입 / 로그인"을
 * 내걸어, **한 화면에서 인증 상태가 서로 모순된다.** 실패는 본문 게이트 한 곳에서만
 * 알리고 헤더는 판단을 보류한다.
 */
export function toAccountMenuSession(
  state: AuthSessionState,
): AuthSession | null {
  switch (state.status) {
    case 'loading':
    case 'error':
      return null;
    case 'anonymous':
      return { isAuthenticated: false };
    case 'authenticated':
      return state.user === null
        ? null
        : { isAuthenticated: true, user: state.user };
    default: {
      const exhaustive: never = state.status;
      return exhaustive;
    }
  }
}
