'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  ensureSessionLoaded,
  getSessionServerSnapshot,
  getSessionSnapshot,
  refreshSession,
  subscribeSession,
  type AuthSessionState,
} from './session-store';

export interface AuthSessionResult extends AuthSessionState {
  /** `status === 'error'`에서 다시 시도한다. 구독 중인 모든 소비자가 함께 갱신된다. */
  retry: () => void;
}

/**
 * 공유 인증 세션 훅.
 *
 * 이 훅이 `features/auth`에 있는 이유는 의존 방향(app → features → lib) 때문이다.
 * 계정 메뉴(`features/auth`)와 라우트 게이트(`app/_shell`)가 같은 상태를 소비해야
 * 하므로 더 낮은 계층에 둔다.
 */
export function useSession(): AuthSessionResult {
  const state = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getSessionServerSnapshot,
  );

  useEffect(() => {
    ensureSessionLoaded();
  }, []);

  const retry = useCallback(() => {
    refreshSession();
  }, []);

  // 저장소는 값이 바뀔 때만 새 객체를 publish하므로 `state` 참조가 안정적이다.
  // 소비자가 이 결과를 useEffect 의존성으로 쓰기 때문에 매 렌더 새 객체를 만들면
  // redirect가 무한히 재실행된다.
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
