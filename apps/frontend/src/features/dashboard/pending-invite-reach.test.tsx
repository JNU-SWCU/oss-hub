// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';

/**
 * 받은 팀 초대 조회·수락·거절은 헤더
 * (`programs/team-invitation-notifications.tsx`)가 소유한다. 대시보드가
 * `team-invitations/received` 나 프로그램·팀 이름 보강(directory fan-out)을
 * 다시 부르면 이 테스트가 실패해야 한다.
 *
 * 가짜는 **네트워크 경계 하나**에만 둔다. 초대 경로를 500으로 돌려도 대시보드
 * 본문은 성공해야 한다 — 그 실패를 catch 해서 조용히 접으면 회귀가 숨는다.
 */

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<'a'> & { readonly href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { StudentDashboardScreen } from './components/student-dashboard-screen';

const requestedPaths: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestPath(input: RequestInfo | URL): string {
  const url = new URL(String(input), 'http://127.0.0.1');
  return url.pathname.slice(apiPath('').length);
}

function isDashboardOwnedInvitePath(path: string): boolean {
  return (
    path === 'team-invitations/received' ||
    /^programs\/[^/]+$/.test(path) ||
    /^programs\/[^/]+\/overview\/teams$/.test(path) ||
    /^team-invitations\/[^/]+\/(accept|decline)$/.test(path)
  );
}

function stubbedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const path = requestPath(input);
  const method = init?.method ?? 'GET';
  requestedPaths.push(`${method} ${path}`);

  if (path === 'dashboard/student') {
    return Promise.resolve(json({ items: [] }));
  }
  if (path === 'users/me/notifications/application-decisions') {
    return Promise.resolve(json([]));
  }
  if (isDashboardOwnedInvitePath(path)) {
    return Promise.resolve(
      json({ detail: `대시보드가 부르면 안 되는 경로: ${path}` }, 500),
    );
  }
  return Promise.resolve(json({ detail: `stub 없음: ${path}` }, 500));
}

describe('학생 대시보드는 받은 팀 초대를 스스로 조회하지 않는다', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    requestedPaths.length = 0;
    vi.stubGlobal('fetch', vi.fn(stubbedFetch));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('team-invitations/received 와 프로그램·팀 이름 보강을 호출하지 않는다', async () => {
    await act(async () => root.render(<StudentDashboardScreen />));

    await vi.waitFor(() => {
      expect(container.textContent ?? '').toContain(
        '아직 신청한 프로그램이 없습니다',
      );
    });

    expect(requestedPaths).toContain('GET dashboard/student');
    expect(requestedPaths).toContain(
      'GET users/me/notifications/application-decisions',
    );
    expect(
      requestedPaths.filter((entry) =>
        isDashboardOwnedInvitePath(entry.slice(entry.indexOf(' ') + 1)),
      ),
    ).toEqual([]);

    const text = container.textContent ?? '';
    expect(text).not.toContain('받은 팀 초대');
    expect(text).not.toContain('팀 초대 수락');
    expect(text).not.toContain('팀 초대 거절');
  });
});
