'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SessionRoleResult } from './use-session-role';

const SessionRoleContext = createContext<SessionRoleResult | null>(null);

export function SessionRoleProvider({
  value,
  children,
}: {
  value: SessionRoleResult;
  children: ReactNode;
}) {
  return (
    <SessionRoleContext.Provider value={value}>
      {children}
    </SessionRoleContext.Provider>
  );
}

export function useSharedSessionRole(): SessionRoleResult {
  const value = useOptionalSharedSessionRole();
  if (value === null) {
    throw new Error(
      'useSharedSessionRole는 AppFrame·RoleGate·OnboardingGate의 SessionRoleProvider 안에서만 쓸 수 있습니다 — 공통 셸이 판단한 세션 스냅샷을 물려받는 훅입니다.',
    );
  }
  return value;
}

export function useOptionalSharedSessionRole(): SessionRoleResult | null {
  return useContext(SessionRoleContext);
}
