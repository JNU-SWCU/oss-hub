// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';

/**
 * 받은 팀 초대가 **대시보드 화면에 실제로 도달하는가**, 그리고 거기서 누른 「수락」이
 * 팀 화면으로 이어지는가.
 *
 * 왜 이 파일이 따로 필요한가. 배너 조각에는 이미 단위 테스트가 있고
 * (`components/pending-team-invites-banner.test.tsx`), 화면이 수락을 처리한다는
 * 테스트도 있다(`student-dashboard-screen.test.tsx`). 그런데 그 둘 사이 — **불러오기가
 * 그 배너까지 이어지고, 배너의 버튼이 그 처리로 이어지는가** — 를 확인하는 것이 없었다.
 * 기존 화면 테스트는 `StudentDashboardView`를 통째로 가짜로 바꾸고 `onAcceptInvite`를
 * 손으로 부른다. 그래서 배너가 화면에서 빠지거나 버튼이 핸들러에 안 묶여도 초록불이다.
 * 같은 형태의 결함이 이 저장소에서 반복됐고(#673·#722·#733), 그때 세운 대응이
 * `test-support/local-review/handlers/student-rejection-reach.test.tsx`다. 이 파일은 팀 초대
 * 갈래의 같은 자리다.
 *
 * 그래서 여기서는 가짜를 **네트워크 경계 하나에만** 세운다. 그 위(불러오기·이름 보강·
 * 화면·배너·버튼)는 전부 진짜로 돈다.
 *
 * ⚠ 대시보드에 참여 카드는 **일부러 0건**으로 둔다. 초대만 받고 아직 아무 프로그램에도
 * 신청하지 않은 학생이 이 기능의 주 대상이고, 그 사람의 화면은 「아직 신청한 프로그램이
 * 없습니다」 빈 상태다. 배너가 그 빈 상태 갈래 **안쪽**에 잘못 놓이면 정작 필요한
 * 사람에게만 안 보이게 된다.
 */

const PROGRAM_ID = 'program-capstone-2026';
const TEAM_ID = 'team-opensource';
const INVITATION_ID = 'invitation-1';
const TEAM_NAME = '오픈소스팀';
const PROGRAM_NAME = '캡스톤 2026';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const routerPush = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

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

/** 그 사이 초대가 닫혔는가 — 두 번째 조회부터 무엇을 돌려줄지 정한다. */
let receivedInvitations: readonly unknown[] = [];
let acceptStatus = 200;
const acceptedInvitationIds: string[] = [];

function pendingInvitation() {
  return {
    id: INVITATION_ID,
    teamId: TEAM_ID,
    programId: PROGRAM_ID,
    invitedById: 'user-leader',
    status: 'PENDING',
    invitedAt: '2026-08-10T00:00:00.000Z',
    respondedAt: null,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 경로별 응답. 화면이 부르는 것만 답하고 나머지는 실패시켜 누락을 드러낸다. */
function stubbedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(String(input), 'http://127.0.0.1');
  const path = url.pathname.slice(apiPath('').length);
  const method = init?.method ?? 'GET';

  if (
    method === 'POST' &&
    path === `team-invitations/${INVITATION_ID}/accept`
  ) {
    if (acceptStatus !== 200) {
      return Promise.resolve(
        json(
          {
            type: 'about:blank',
            title: '충돌',
            status: acceptStatus,
            detail: '이미 처리된 초대입니다.',
            instance: url.pathname,
            code: 'TIV_011',
          },
          acceptStatus,
        ),
      );
    }
    acceptedInvitationIds.push(INVITATION_ID);
    return Promise.resolve(json({ teamId: TEAM_ID, programId: PROGRAM_ID }));
  }
  if (path === 'team-invitations/received') {
    return Promise.resolve(json(receivedInvitations));
  }
  if (path === `programs/${PROGRAM_ID}`) {
    return Promise.resolve(json({ id: PROGRAM_ID, name: PROGRAM_NAME }));
  }
  if (path === `programs/${PROGRAM_ID}/overview/teams`) {
    return Promise.resolve(json([{ teamId: TEAM_ID, name: TEAM_NAME }]));
  }
  if (path === 'dashboard/student') {
    // 신청한 프로그램이 없는 학생 — 위 주석의 빈 상태 갈래를 만든다.
    return Promise.resolve(json({ items: [] }));
  }
  if (path === 'users/me/notifications/application-decisions') {
    return Promise.resolve(json([]));
  }
  return Promise.resolve(json({ detail: `stub 없음: ${path}` }, 500));
}

/**
 * 불러오기가 여러 단계로 이어져 있어(초대 목록을 받은 뒤 이름 보강이 한 번 더 온다)
 * 한 번의 flush로는 끝까지 가지 않는다. 저장소 관례대로 보고 싶은 상태가 될 때까지
 * 기다린다 — 고정 횟수로 마이크로태스크를 돌리면 단계가 하나 늘 때 화면이 멀쩡한데도
 * 엉뚱하게 실패한다.
 */
async function settleUntil(assert: () => void): Promise<void> {
  await vi.waitFor(assert);
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (!button) {
    throw new Error(
      `「${label}」 버튼이 화면에 없습니다. 실제 본문: ${container.textContent ?? ''}`,
    );
  }
  return button;
}

describe('받은 팀 초대가 학생 대시보드에 도달하고 거기서 수락된다', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    receivedInvitations = [pendingInvitation()];
    acceptStatus = 200;
    acceptedInvitationIds.length = 0;
    routerPush.mockReset();
    vi.stubGlobal('fetch', vi.fn(stubbedFetch));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('신청한 프로그램이 하나도 없어도 초대가 화면에 나타난다', async () => {
    // When: 대시보드를 불러오기째 연다
    await act(async () => root.render(<StudentDashboardScreen />));

    // Then: 팀·프로그램 이름이 실제 DOM 에 있다 — 조각 테스트가 아니라 화면이다.
    await settleUntil(() => {
      expect(container.textContent ?? '').toContain(TEAM_NAME);
    });
    const text = container.textContent ?? '';
    expect(text).toContain(TEAM_NAME);
    expect(text).toContain(PROGRAM_NAME);
    // 그리고 이 학생은 참여 카드가 0건이라 빈 상태 문구도 함께 있다 —
    // 배너가 그 갈래 안쪽으로 들어가면 이 단언 중 하나가 깨진다.
    expect(text).toContain('아직 신청한 프로그램이 없습니다');
  });

  it('화면의 수락 버튼을 누르면 초대가 수락되고 그 팀 화면으로 이동한다', async () => {
    await act(async () => root.render(<StudentDashboardScreen />));
    await settleUntil(() => {
      expect(container.textContent ?? '').toContain(TEAM_NAME);
    });

    // When: 사람이 누르는 그 버튼을 그대로 누른다
    const accept = findButton(container, `${TEAM_NAME} 팀 초대 수락`);
    await act(async () => {
      accept.click();
    });

    // Then: 네트워크까지 갔고, 목적지는 그 팀의 팀 화면이다
    await settleUntil(() => {
      expect(acceptedInvitationIds).toEqual([INVITATION_ID]);
    });
    expect(routerPush).toHaveBeenCalledWith(`/programs/${PROGRAM_ID}/teams`);
  });

  it('그 사이 닫힌 초대를 수락하면 사유를 보여 주고 배너에서 치운다', async () => {
    // Given: 화면에는 남아 있지만 서버에서는 이미 닫힌 초대
    await act(async () => root.render(<StudentDashboardScreen />));
    await settleUntil(() => {
      expect(container.textContent ?? '').toContain(TEAM_NAME);
    });
    acceptStatus = 409;
    receivedInvitations = [];

    // When
    const accept = findButton(container, `${TEAM_NAME} 팀 초대 수락`);
    await act(async () => {
      accept.click();
    });

    // Then: 죽은 초대는 사라진다 — 남겨 두면 눌러도 같은 오류만 반복된다.
    await settleUntil(() => {
      expect(container.textContent ?? '').not.toContain(TEAM_NAME);
    });

    // ⚠ 그런데 항목만 조용히 사라지면 누른 사람 눈에는 **수락된 것처럼** 보인다.
    // 실제로는 팀에 못 들어갔으므로 서버가 준 사유가 화면에 남아 있어야 한다.
    const text = container.textContent ?? '';
    expect(text).toContain('이미 처리된 초대입니다');
    expect(routerPush).not.toHaveBeenCalled();
  });
});
