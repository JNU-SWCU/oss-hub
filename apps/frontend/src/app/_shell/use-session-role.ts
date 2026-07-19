'use client';

import { useEffect, useState } from 'react';
import { fetchMe } from '@/features/auth/api';
import type { AppRole } from './role';

export type SessionStatus = 'loading' | 'anonymous' | 'unassigned' | 'assigned';

export interface SessionRoleState {
  status: SessionStatus;
  role: AppRole | null;
}

/**
 * `/auth/me` 계약(`apps/backend/src/auth/dto/me-response.dto.ts`)은 이미
 * `role: TestRole | null`을 응답에 포함하지만, `features/auth`(owner
 * @Lumiere001 전속 경로, AGENTS.md §3)의 `Me` 타입은 아직 `role`을 노출하지
 * 않는다. owner 경로를 직접 수정하지 않고 이 훅에서만 응답을 로컬로 넓혀
 * 소비한다 — PR 본문에 owner 확인 요청을 남긴다.
 */
interface MeWithRole {
  role: AppRole | null;
}

/**
 * 세션·역할 조회 훅. `role=null`은 "역할 미선택"과 "교직원 승인 대기(PENDING)"를
 * 구분하지 않는다 — 현재 `/auth/me`가 TestRoleMap 기반이라 두 상태를 구분해
 * 노출하지 않기 때문이며, #107 스텁 화면 하나로 수렴하는 것이 플랜 합의 사항이다.
 */
export function useSessionRole(): SessionRoleState {
  const [state, setState] = useState<SessionRoleState>({
    status: 'loading',
    role: null,
  });

  useEffect(() => {
    let active = true;

    fetchMe()
      .then((me) => {
        if (!active) return;
        const role = (me as unknown as MeWithRole).role ?? null;
        setState(
          role
            ? { status: 'assigned', role }
            : { status: 'unassigned', role: null },
        );
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
