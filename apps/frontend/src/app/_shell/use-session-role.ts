'use client';

import { useEffect, useState } from 'react';
import { fetchSession } from '@/features/auth/api';
import type { AuthSession } from '@/features/auth/types';
import type { AppRole } from './role';

export type SessionStatus = 'loading' | 'anonymous' | 'unassigned' | 'assigned';

export interface SessionRoleState {
  status: SessionStatus;
  role: AppRole | null;
}

/**
 * in-flight promise dedup. 동시에 mount되는 여러 `useSessionRole` 인스턴스가
 * fetch를 각자 트리거하지 않고 하나의 진행 중인 promise를 공유하게 만드는
 * 순수 함수 — 주입 가능해 독립적으로 테스트한다(use-session-role.test.ts).
 * settle(성공·실패 모두) 시 in-flight 슬롯을 반드시 비워, 다음 호출(예: 로그인/
 * 로그아웃 이후의 새 mount)은 캐시된 결과가 아니라 새 fetch를 받는다.
 */
export function createDedupedFetcher<T>(
  fetcher: () => Promise<T>,
): () => Promise<T> {
  let inFlight: Promise<T> | null = null;

  return () => {
    if (!inFlight) {
      inFlight = fetcher().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}

const dedupedFetchSession = createDedupedFetcher(fetchSession);

export function toSessionRoleState(session: AuthSession): SessionRoleState {
  switch (session.isAuthenticated) {
    case false:
      return { status: 'anonymous', role: null };
    case true: {
      const role = session.user.role;
      return role
        ? { status: 'assigned', role }
        : { status: 'unassigned', role: null };
    }
    default: {
      const exhaustive: never = session;
      return exhaustive;
    }
  }
}

/**
 * 세션·역할 조회 훅. `role=null`은 "역할 미선택"과 "교직원 승인 대기(PENDING)"를
 * 구분하지 않는다 — 현재 `/auth/session`이 두 상태를 구분해
 * 노출하지 않기 때문이며, #107 스텁 화면 하나로 수렴하는 것이 플랜 합의 사항이다.
 */
export function useSessionRole(): SessionRoleState {
  const [state, setState] = useState<SessionRoleState>({
    status: 'loading',
    role: null,
  });

  useEffect(() => {
    let active = true;

    dedupedFetchSession()
      .then((session) => {
        if (!active) return;
        setState(toSessionRoleState(session));
      })
      .catch(() => {
        if (active) setState({ status: 'anonymous', role: null });
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
}
