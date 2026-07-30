'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchSession } from '@/features/auth/api';
import type { AuthSession } from '@/features/auth/types';
import { fetchMyRoleRequest } from '@/features/roles/api';
import type { RoleRequestStatus } from '@/features/roles/types';
import type { AppRole } from './role';

/**
 * `error`는 조회 자체가 실패한 상태다 — 비로그인(`anonymous`)과 반드시 구분한다.
 *
 * `/auth/session`은 비로그인일 때도 200으로 `isAuthenticated: false`를 돌려주므로,
 * 예외가 던져지는 경우는 전부 진짜 실패(네트워크 단절·5xx·응답 파싱 실패)다.
 * 이전 구현은 그 실패를 `anonymous`로 접어 넣어 로그인한 사용자를 랜딩으로
 * 되돌렸다. 화면에는 로그아웃된 것처럼 보이지만 실제로는 세션이 살아 있어
 * 사용자가 원인을 알 수도, 재시도할 수도 없었다.
 */
export type SessionStatus =
  'loading' | 'error' | 'anonymous' | 'unassigned' | 'assigned';

export interface SessionRoleState {
  status: SessionStatus;
  role: AppRole | null;
  roleRequestStatus: RoleRequestStatus | null;
}

export interface SessionRoleResult extends SessionRoleState {
  /** `status === 'error'`에서 같은 조회를 다시 시도한다. 그 외 상태에서는 무해하다. */
  retry: () => void;
}

const LOADING_STATE: SessionRoleState = {
  status: 'loading',
  role: null,
  roleRequestStatus: null,
};

const ERROR_STATE: SessionRoleState = {
  status: 'error',
  role: null,
  roleRequestStatus: null,
};

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
export function useSessionRole(): SessionRoleResult {
  const [state, setState] = useState<SessionRoleState>(LOADING_STATE);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setState(LOADING_STATE);
    setAttempt((previous) => previous + 1);
  }, []);

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
            // 역할 요청 조회 실패도 error로 둔다. `unassigned`로 흘리면 이미 승인
            // 대기 중인 사용자에게 역할 선택 화면을 보여주게 되고, 사용자는 같은
            // 요청을 다시 만들려 한다. 재시도는 한 번의 클릭이므로 잘못된 화면을
            // 보여주는 쪽이 비용이 크다.
            if (active) {
              setState(ERROR_STATE);
            }
          });
      })
      .catch(() => {
        if (active) {
          setState(ERROR_STATE);
        }
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  // state가 그대로면 같은 객체를 돌려준다 — 소비하는 게이트가 `state`를 useEffect
  // 의존성으로 쓰므로, 매 렌더마다 새 객체를 만들면 redirect가 무한히 재실행된다.
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
