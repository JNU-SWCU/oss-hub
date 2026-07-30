'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/features/auth/use-session';
import { fetchMyRoleRequest } from '@/features/roles/api';
import type { RoleRequestStatus } from '@/features/roles/types';
import type { AppRole } from './role';

/**
 * `error`는 조회 자체가 실패한 상태다 — 비로그인(`anonymous`)과 반드시 구분한다.
 * 판정 근거는 `features/auth/session-store.ts` 주석에 있다.
 */
export type SessionStatus =
  'loading' | 'error' | 'anonymous' | 'unassigned' | 'assigned';

export interface SessionRoleState {
  readonly status: SessionStatus;
  readonly role: AppRole | null;
  readonly roleRequestStatus: RoleRequestStatus | null;
}

export interface SessionRoleResult extends SessionRoleState {
  /** `status === 'error'`에서 세션과 역할 요청을 함께 다시 조회한다. */
  retry: () => void;
}

const LOADING: SessionRoleState = {
  status: 'loading',
  role: null,
  roleRequestStatus: null,
};
const ERROR: SessionRoleState = {
  status: 'error',
  role: null,
  roleRequestStatus: null,
};
const ANONYMOUS: SessionRoleState = {
  status: 'anonymous',
  role: null,
  roleRequestStatus: null,
};

type RoleRequestFetch =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loaded'; readonly status: RoleRequestStatus | null }
  | { readonly kind: 'failed' };

/**
 * 라우트 게이트가 쓰는 세션·역할 상태.
 *
 * 인증 세션은 공유 저장소(`features/auth`)에서 오고, 역할 요청 조회는 여기서
 * 이어 붙인다 — 역할 요청은 `features/roles`에 속하고 feature 간 직접 의존이
 * 금지되어 있어, 두 feature를 함께 쓰는 이 app 계층이 조합을 담당한다.
 */
export function useSessionRole(): SessionRoleResult {
  const session = useSession();
  const [roleRequest, setRoleRequest] = useState<RoleRequestFetch>({
    kind: 'idle',
  });

  const needsRoleRequest =
    session.status === 'authenticated' && session.user?.role == null;

  useEffect(() => {
    if (!needsRoleRequest) {
      setRoleRequest({ kind: 'idle' });
      return;
    }

    let active = true;
    fetchMyRoleRequest()
      .then((request) => {
        if (active) {
          setRoleRequest({ kind: 'loaded', status: request?.status ?? null });
        }
      })
      .catch(() => {
        // 역할 요청 조회 실패도 error로 둔다. `unassigned`로 흘리면 이미 승인 대기
        // 중인 사용자에게 역할 선택 화면을 보여주고 중복 요청을 유도한다.
        if (active) {
          setRoleRequest({ kind: 'failed' });
        }
      });

    return () => {
      active = false;
    };
  }, [needsRoleRequest]);

  const retry = useCallback(() => {
    setRoleRequest({ kind: 'idle' });
    session.retry();
  }, [session]);

  const state = useMemo<SessionRoleState>(() => {
    switch (session.status) {
      case 'loading':
        return LOADING;
      case 'error':
        return ERROR;
      case 'anonymous':
        return ANONYMOUS;
      case 'authenticated': {
        const role = session.user?.role ?? null;
        if (role !== null) {
          return { status: 'assigned', role, roleRequestStatus: null };
        }
        switch (roleRequest.kind) {
          case 'idle':
            return LOADING;
          case 'failed':
            return ERROR;
          case 'loaded':
            return {
              status: 'unassigned',
              role: null,
              roleRequestStatus: roleRequest.status,
            };
          default: {
            const exhaustive: never = roleRequest;
            return exhaustive;
          }
        }
      }
      default: {
        const exhaustive: never = session.status;
        return exhaustive;
      }
    }
  }, [roleRequest, session.status, session.user]);

  // 게이트가 이 결과를 useEffect 의존성으로 쓰기 때문에 매 렌더 새 객체를 만들면
  // redirect가 무한히 재실행된다.
  return useMemo(() => ({ ...state, retry }), [retry, state]);
}
