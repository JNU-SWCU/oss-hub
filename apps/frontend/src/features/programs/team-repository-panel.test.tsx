// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { RepositoryUrlState } from './repository-url-api';
import {
  getRepositoryHistory,
  getTeamActivity,
  type TeamActivity,
} from './team-activity-api';
import { TeamRepositoryPanel } from './team-repository-panel';

vi.mock('./team-activity-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./team-activity-api')>()),
  getTeamActivity: vi.fn(),
  getRepositoryHistory: vi.fn(),
}));
vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: ReactNode }) => (
    <div data-chart="">{children}</div>
  );
  const Nothing = () => null;
  return {
    CartesianGrid: Nothing,
    Line: Nothing,
    LineChart: Pass,
    ReferenceLine: Nothing,
    ResponsiveContainer: Pass,
    XAxis: Nothing,
    YAxis: Nothing,
  };
});

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const leader = {
  userId: 'user-1',
  githubLogin: 'synthetic-leader',
  totals: { commitCount: 4, pullRequestCount: 0, issueCount: 0 },
  points: [
    { date: '2026-08-04', commitCount: 4, pullRequestCount: 0, issueCount: 0 },
  ],
};
const original: TeamActivity = {
  applicationId: 'application-1',
  repository: { id: 'repo-a', url: 'https://github.com/synthetic/a' },
  status: 'COLLECTED',
  lastSuccessAt: '2026-08-17T01:00:00.000Z',
  window: { from: '2026-08-03', to: '2026-08-16', timeZone: 'Asia/Seoul' },
  canEditRepositoryUrl: true,
  members: [leader],
};
/** B로 바꾼 직후 — 아직 B를 모으지 않았다. A의 수를 가져오지 않는다. */
const relinked: TeamActivity = {
  ...original,
  repository: { id: 'repo-b', url: 'https://github.com/synthetic/b' },
  status: 'NOT_COLLECTED',
  lastSuccessAt: null,
  members: [
    {
      ...leader,
      totals: { commitCount: 0, pullRequestCount: 0, issueCount: 0 },
      points: [],
    },
  ],
};

describe('TeamRepositoryPanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  const saveRepositoryUrl =
    vi.fn<(repositoryUrl: string) => Promise<RepositoryUrlState>>();
  const onSaved = vi.fn();
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(getTeamActivity).mockReset().mockResolvedValue(original);
    vi.mocked(getRepositoryHistory)
      .mockReset()
      .mockResolvedValue({ items: [], nextCursor: null });
    saveRepositoryUrl.mockReset();
    onSaved.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  async function render(teamId = 'team-1') {
    await act(async () =>
      root.render(
        <TeamRepositoryPanel
          programId="program-1"
          teamId={teamId}
          activityTitle="우리 팀 활동"
          saveRepositoryUrl={saveRepositoryUrl}
          onSaved={onSaved}
        >
          <p>화면 고유 줄</p>
        </TeamRepositoryPanel>,
      ),
    );
  }
  function button(label: string): HTMLButtonElement {
    const found = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find(
      (item) =>
        (item.getAttribute('aria-label') ?? item.textContent?.trim()) === label,
    );
    if (!found) throw new Error(`Missing button ${label}`);
    return found;
  }
  async function changeUrlTo(value: string) {
    await act(async () => button('저장소 URL 수정').click());
    const input = container.querySelector<HTMLInputElement>('#repository-url');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, value);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
  }
  function repositoryLink(): string | null | undefined {
    return container
      .querySelector('section[aria-label="프로젝트 저장소"] a')
      ?.getAttribute('href');
  }

  it('한 조회로 URL 줄과 그래프를 함께 그린다', async () => {
    await render();
    expect(getTeamActivity).toHaveBeenCalledExactlyOnceWith(
      'program-1',
      'team-1',
    );
    expect(repositoryLink()).toBe('https://github.com/synthetic/a');
    expect(button('저장소 URL 수정').disabled).toBe(false);
    expect(container.textContent).toContain('화면 고유 줄');
    const activity = container.querySelector('[role="region"]');
    expect(activity?.textContent).toContain('우리 팀 활동');
    expect(activity?.querySelector('[data-chart]')).not.toBeNull();
  });

  it('처음 읽기에 실패하면 실패 표면 하나와 재시도를 둔다', async () => {
    vi.mocked(getTeamActivity).mockRejectedValueOnce(new Error('network'));
    await render();
    expect(container.textContent).toContain('저장소를 불러오지 못했습니다');
    expect(
      container.querySelector('section[aria-label="프로젝트 저장소"]'),
    ).toBeNull();
    await act(async () => button('다시 시도').click());
    expect(repositoryLink()).toBe('https://github.com/synthetic/a');
  });

  it('저장하면 그래프가 새 저장소를 따라가고 옛 수를 남기지 않는다', async () => {
    const pending = deferred<TeamActivity>();
    saveRepositoryUrl.mockResolvedValue({
      repositoryUrl: 'https://github.com/synthetic/b',
      canEditRepositoryUrl: true,
    });
    await render();
    vi.mocked(getTeamActivity).mockReturnValueOnce(pending.promise);

    await changeUrlTo('https://github.com/synthetic/b');

    expect(saveRepositoryUrl).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/synthetic/b',
    );
    expect(onSaved).toHaveBeenCalledOnce();
    expect(repositoryLink()).toBe('https://github.com/synthetic/b');
    // 다시 읽는 동안 A의 그래프를 B의 주소 아래 두지 않는다.
    expect(container.querySelector('[data-chart]')).toBeNull();
    expect(getTeamActivity).toHaveBeenCalledTimes(2);

    await act(async () => pending.resolve(relinked));
    expect(container.textContent).toContain('첫 수집을 기다리는 중입니다');
    expect(repositoryLink()).toBe('https://github.com/synthetic/b');
  });

  it('저장 전에 시작한 느린 조회가 저장 뒤의 주소를 덮지 않는다', async () => {
    const stale = deferred<TeamActivity>();
    await render();
    saveRepositoryUrl
      .mockRejectedValueOnce(
        new ApiError({
          type: 'about:blank',
          title: '요청 처리 실패',
          status: 409,
          detail: '합성 충돌입니다.',
          instance: '/programs/program-1',
          code: 'APP_050',
        }),
      )
      .mockResolvedValueOnce({
        repositoryUrl: 'https://github.com/synthetic/b',
        canEditRepositoryUrl: true,
      });
    await changeUrlTo('https://github.com/synthetic/b');
    vi.mocked(getTeamActivity)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue(relinked);
    // 거절된 뒤 「다시 불러오기」가 느리게 도는 사이 다시 저장한다.
    await act(async () => button('다시 불러오기').click());
    await act(async () =>
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
    expect(repositoryLink()).toBe('https://github.com/synthetic/b');

    await act(async () => stale.resolve(original));

    expect(repositoryLink()).toBe('https://github.com/synthetic/b');
    expect(container.textContent).not.toContain(
      'https://github.com/synthetic/a',
    );
  });

  it('변경 이력은 접혀 있고 펼칠 때 첫 쪽을 읽으며, 저장하면 다시 읽는다', async () => {
    saveRepositoryUrl.mockResolvedValue({
      repositoryUrl: 'https://github.com/synthetic/b',
      canEditRepositoryUrl: true,
    });
    await render();
    const trigger = button('저장소 URL 변경 이력');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(getRepositoryHistory).not.toHaveBeenCalled();

    await act(async () => trigger.click());
    expect(getRepositoryHistory).toHaveBeenCalledExactlyOnceWith(
      'program-1',
      'team-1',
    );
    expect(container.textContent).toContain('저장소 URL 변경 이력이 없습니다.');

    vi.mocked(getRepositoryHistory).mockResolvedValue({
      items: [
        {
          id: 'audit-1',
          occurredAt: '2026-09-01T00:00:00.000Z',
          actorGithubLogin: 'synthetic-leader',
          previousRepositoryUrl: 'https://github.com/synthetic/a',
          newRepositoryUrl: 'https://github.com/synthetic/b',
        },
      ],
      nextCursor: null,
    });
    await changeUrlTo('https://github.com/synthetic/b');
    expect(getRepositoryHistory).toHaveBeenCalledTimes(2);
    const history = container.querySelector(
      'section[aria-label="저장소 URL 변경 이력"]',
    );
    expect(history?.textContent).toContain('@synthetic-leader');
    expect(history?.textContent).toContain('2026년 9월 1일 09:00');
    expect(history?.textContent).toContain('https://github.com/synthetic/a');
  });

  it('팀이 바뀌면 이전 팀의 주소를 남기지 않고 새로 읽는다', async () => {
    await render('team-1');
    const next = deferred<TeamActivity>();
    vi.mocked(getTeamActivity).mockReturnValueOnce(next.promise);
    await render('team-2');
    expect(getTeamActivity).toHaveBeenLastCalledWith('program-1', 'team-2');
    expect(repositoryLink()).toBeUndefined();
    await act(async () => next.resolve(relinked));
    expect(repositoryLink()).toBe('https://github.com/synthetic/b');
  });
});
