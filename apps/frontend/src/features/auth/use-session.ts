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
  retry: () => void;
}

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

  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
