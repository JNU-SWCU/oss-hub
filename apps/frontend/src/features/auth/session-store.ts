'use client';

import { fetchSession } from './api';
import { ApiError } from '@/lib/api-client';
import type { Me } from './types';

/**
 * `error`는 조회 자체가 실패한 상태다 — 비로그인(`anonymous`)과 반드시 구분한다.
 *
 * `/auth/session`의 401은 만료·비활성화 등으로 기존 세션을 더 이상 쓸 수 없다는
 * 응답이므로 비로그인으로 정규화한다. 그 외 예외(네트워크 단절·5xx·응답 파싱
 * 실패)는 진짜 조회 실패다. 이 실패를 비로그인으로 접으면 살아 있는 세션을 로그아웃처럼
 * 표시해 사용자가 원인도 재시도 수단도 알 수 없다.
 */
export type AuthSessionStatus =
  'loading' | 'error' | 'anonymous' | 'authenticated';

export interface AuthSessionState {
  readonly status: AuthSessionStatus;
  readonly user: Me | null;
}

const LOADING_STATE: AuthSessionState = { status: 'loading', user: null };
const ERROR_STATE: AuthSessionState = { status: 'error', user: null };
const ANONYMOUS_STATE: AuthSessionState = { status: 'anonymous', user: null };

/**
 * 인증 상태는 화면 전체에서 하나여야 한다.
 *
 * 이전 구현은 소비자마다 상태와 재시도를 따로 들고 있었고 in-flight promise만
 * 공유했다. 그래서 본문 게이트에서 재시도해 복구해도 헤더의 계정 메뉴는 자기 상태를
 * 그대로 유지해, **한 화면에 로그인된 본문과 비로그인 헤더가 동시에 보였다.**
 * 인증 표시가 서로 모순되면 사용자는 어느 쪽을 믿어야 할지 알 수 없다.
 *
 * 그래서 모듈 수준 저장소 하나를 두고 모든 소비자가 같은 스냅샷을 구독한다. 쿼리
 * 캐시 라이브러리를 새로 들이지 않은 이유는 필요한 동작이 "단일 값 + 구독 + 갱신"뿐
 * 이라 `useSyncExternalStore`로 충분하기 때문이다.
 *
 * 역할 요청 조회는 여기 넣지 않는다 — `features/roles`에 속하고 feature 간 직접
 * 의존이 금지되어 있어, 두 feature를 함께 쓰는 app 계층이 그 조합을 담당한다.
 */
let snapshot: AuthSessionState = LOADING_STATE;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let generation = 0;

function publish(next: AuthSessionState): void {
  snapshot = next;
  for (const listener of [...listeners]) {
    listener();
  }
}

async function load(loadGeneration: number): Promise<void> {
  try {
    const session = await fetchSession();
    if (loadGeneration !== generation) return;
    if (!session.isAuthenticated) {
      publish(ANONYMOUS_STATE);
      return;
    }

    publish({ status: 'authenticated', user: session.user });
  } catch (error: unknown) {
    if (loadGeneration !== generation) return;
    if (error instanceof ApiError && error.problem.status === 401) {
      publish(ANONYMOUS_STATE);
      return;
    }

    publish(ERROR_STATE);
  }
}

/** 아직 불러오지 않았으면 한 번만 불러온다. 동시 호출은 같은 요청을 공유한다. */
export function ensureSessionLoaded(): void {
  if (inFlight !== null || snapshot.status !== 'loading') {
    return;
  }
  const request = load(generation).finally(() => {
    if (inFlight === request) {
      inFlight = null;
    }
  });
  inFlight = request;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSessionSnapshot(): AuthSessionState {
  return snapshot;
}

/**
 * 서버 렌더 스냅샷. 클라이언트 전용 상태이므로 항상 `loading`으로 시작해
 * hydration 불일치를 만들지 않는다.
 */
export function getSessionServerSnapshot(): AuthSessionState {
  return LOADING_STATE;
}

/** 조회 실패 후 다시 시도한다. 구독 중인 모든 소비자가 함께 갱신된다. */
export function refreshSession(): void {
  generation += 1;
  inFlight = null;
  publish(LOADING_STATE);
  ensureSessionLoaded();
}

/** 테스트 전용 — 모듈 수준 상태를 초기화한다. */
export function resetSessionStore(): void {
  generation += 1;
  inFlight = null;
  snapshot = LOADING_STATE;
  listeners.clear();
}
