'use client';

import { useEffect, useState } from 'react';
import { fetchSession } from '@/features/auth/api';
import type { AuthSession } from '@/features/auth/types';
import { fetchMyRoleRequest } from '@/features/roles/api';
import type { RoleRequestStatus } from '@/features/roles/types';
import type { AppRole } from './role';

export type SessionStatus = 'loading' | 'anonymous' | 'unassigned' | 'assigned';

export interface SessionRoleState {
  status: SessionStatus;
  role: AppRole | null;
  roleRequestStatus: RoleRequestStatus | null;
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
const dedupedFetchMyRoleRequest = createDedupedFetcher(fetchMyRoleRequest);

export function toSessionRoleState(session: AuthSession): SessionRoleState {
  switch (session.isAuthenticated) {
    case false:
      return {
        status: 'anonymous',
        role: null,
        roleRequestStatus: null,
      };
    case true: {
      const role = session.user.role;
      return role
        ? { status: 'assigned', role, roleRequestStatus: null }
        : { status: 'unassigned', role: null, roleRequestStatus: null };
    }
    default: {
      const exhaustive: never = session;
      return exhaustive;
    }
  }
}

/**
 * 세션·역할 조회 훅. 확정 역할이 없으면 #107 본인 역할 요청을 이어서 조회해
 * 역할 선택과 승인 대기·반려 경로를 구분한다.
 */
export function useSessionRole(): SessionRoleState {
  const [state, setState] = useState<SessionRoleState>({
    status: 'loading',
    role: null,
    roleRequestStatus: null,
  });

  useEffect(() => {
    let active = true;

    dedupedFetchSession()
      .then((session) => {
        if (!active) return;

        const sessionState = toSessionRoleState(session);
        if (sessionState.status !== 'unassigned') {
          setState(sessionState);
          return;
        }

        dedupedFetchMyRoleRequest()
          .then((request) => {
            if (active) {
              setState({
                ...sessionState,
                roleRequestStatus: request?.status ?? null,
              });
            }
          })
          .catch(() => {
            if (active) {
              setState(sessionState);
            }
          });
      })
      .catch(() => {
        if (active) {
          setState({
            status: 'anonymous',
            role: null,
            roleRequestStatus: null,
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
}
