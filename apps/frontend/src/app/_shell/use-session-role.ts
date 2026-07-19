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

const dedupedFetchMe = createDedupedFetcher(fetchMe);

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

    dedupedFetchMe()
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
