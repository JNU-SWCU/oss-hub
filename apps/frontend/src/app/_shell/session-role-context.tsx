'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SessionRoleResult } from './use-session-role';

/**
 * 게이트가 이미 읽은 세션·역할 스냅샷을 그 아래 화면이 그대로 물려받는 자리.
 *
 * `useSessionRole()`을 화면에서 한 번 더 부르면 역할 요청 조회(`fetchMyRoleRequest`
 * ·`fetchMyRoleSelection`)가 두 번 나가고, 더 나쁘게는 **서로 다른 순간의 답**을
 * 본다 — 게이트는 "승인 대기 교직원"으로 판단해 화면을 열어 줬는데 그 사이 승인이
 * 떨어지면, 같은 렌더 트리 안에서 화면은 다른 근거로 폼을 그린다. 접근을 판단한
 * 스냅샷과 폼이 무엇을 물을지 정하는 스냅샷은 같은 값이어야 한다.
 *
 * 그래서 fallback을 두지 않는다. 컨텍스트가 없으면 조합이 잘못된 것이고, 그때
 * 조용히 스스로 조회하면 정확히 위 문제로 돌아간다.
 */
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

/** 게이트가 판단에 쓴 바로 그 스냅샷. 게이트 밖에서 부르면 조합 실수다. */
export function useSharedSessionRole(): SessionRoleResult {
  const value = useContext(SessionRoleContext);
  if (value === null) {
    throw new Error(
      'useSharedSessionRole는 RoleGate 안에서만 쓸 수 있습니다 — 게이트가 판단한 세션 스냅샷을 물려받는 훅입니다.',
    );
  }
  return value;
}
