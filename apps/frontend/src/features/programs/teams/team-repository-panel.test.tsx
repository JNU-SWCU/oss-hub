import { act, type ReactNode } from 'react';
import { createListScreenRoot as createRoot } from '../../../../test-support/list-screen-root';
type Root = ReturnType<typeof createRoot>;
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { RepositoryUrlState } from './repository-url-dto';
import { getRepositoryHistory, getTeamActivity } from './team-activity-api';
import type { TeamActivity } from './team-activity-dto';
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
const linkedRepository = {
  id: 'repo-a',
  url: 'https://github.com/synthetic/a',
  defaultBranch: 'trunk',
};
const original: TeamActivity = {
  teamId: 'application-1',
  repository: linkedRepository,
  status: 'COLLECTED',
  lastSuccessAt: '2026-08-17T01:00:00.000Z',
  window: { from: '2026-08-03', to: '2026-08-16', timeZone: 'Asia/Seoul' },
  canEditRepositoryUrl: true,
  members: [leader],
};

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

const repositoryChange = {
  id: 'audit-1',
  occurredAt: '2026-08-31T23:59:00.000Z',
  actorGithubLogin: 'synthetic-leader',
  previousRepositoryUrl: 'https://github.com/synthetic/a/',
  newRepositoryUrl: 'https://github.com/synthetic/b',
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
    vi.useRealTimers();
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
    await act(async () => button('변경').click());
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
  function repositoryCard(): HTMLElement | null {
    return container.querySelector('section[aria-label="프로젝트 저장소"]');
  }
  function repositoryLink(): string | null | undefined {
    return repositoryCard()?.querySelector('a')?.getAttribute('href');
  }

  it('한 조회로 저장소 이름과 수집 정보, 그래프를 함께 그린다', async () => {
    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'));
    await render();
    expect(getTeamActivity).toHaveBeenCalledExactlyOnceWith(
      'program-1',
      'team-1',
    );
    const card = repositoryCard();
    const link = card?.querySelector('a');
    expect(link?.getAttribute('href')).toBe(linkedRepository.url);
    expect(link?.textContent).toBe('synthetic/a');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noopener');
    const collected = card?.querySelector('time');
    expect(collected?.getAttribute('datetime')).toBe(original.lastSuccessAt);
    expect(collected?.parentElement?.textContent).toContain(
      '기본 브랜치 trunk · 마지막 수집 23시간 전',
    );
    expect(button('변경').disabled).toBe(false);
    expect(card?.textContent).toContain('화면 고유 줄');
    const activity = container.querySelector('[role="region"]');
    expect(activity?.textContent).toContain('우리 팀 활동');
    expect(activity?.querySelector('[data-chart]')).not.toBeNull();
  });

  it('브랜치가 응답에 없으면 마지막 수집만 보이고 구분점은 없다', async () => {
    vi.mocked(getTeamActivity).mockResolvedValue({
      ...original,
      repository: { id: linkedRepository.id, url: linkedRepository.url },
    });
    await render();

    const row = repositoryCard()?.querySelector('time')?.parentElement;
    expect(row?.textContent).toMatch(/^마지막 수집 /);
    expect(row?.textContent).not.toContain('·');
  });

  it('같은 카드에서 링크 대신 편집기를 열고 취소하면 변경으로 초점을 돌린다', async () => {
    await render();
    const card = repositoryCard();
    await act(async () => button('변경').click());

    expect(card).toBe(repositoryCard());
    expect(card?.querySelector('a')).toBeNull();
    const form = card?.querySelector('form');
    const input = form?.querySelector('input');
    expect(input?.labels?.[0]?.textContent).toBe('저장소 주소');
    expect(input?.value).toBe(linkedRepository.url);
    expect(document.activeElement).toBe(input);
    expect(
      Array.from(form?.querySelectorAll('button') ?? []).map(
        (action) => action.textContent,
      ),
    ).toEqual(['취소', '저장']);
    expect(button('변경 이력').closest('section')).toBe(card);

    await act(async () => button('취소').click());
    expect(card?.querySelector('form')).toBeNull();
    expect(repositoryLink()).toBe(linkedRepository.url);
    expect(document.activeElement).toBe(button('변경'));
    expect(saveRepositoryUrl).not.toHaveBeenCalled();
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
    expect(repositoryCard()?.textContent).not.toContain('기본 브랜치');
    expect(repositoryCard()?.textContent).not.toContain('마지막 수집');

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
    expect(repositoryCard()?.textContent).not.toContain('기본 브랜치 trunk');
  });

  it('미확정 저장 뒤 같은 응답을 다시 받아도 입력을 남기고 저장 잠금을 푼다', async () => {
    saveRepositoryUrl.mockRejectedValueOnce(new Error('network'));
    await render();
    const draft = 'https://github.com/synthetic/b';
    await changeUrlTo(draft);
    expect(button('저장소 주소 저장').disabled).toBe(true);

    await act(async () => button('다시 불러오기').click());
    expect(getTeamActivity).toHaveBeenCalledTimes(2);
    expect(button('저장소 주소 저장').disabled).toBe(false);
    expect(repositoryCard()?.querySelector('input')?.value).toBe(draft);
  });

  it('활동 응답에 전체 건수가 있으면 이력 조회 전에 표시한다', async () => {
    vi.mocked(getTeamActivity).mockResolvedValue({
      ...original,
      repositoryUrlHistoryCount: 3,
    });
    await render();
    expect(button('변경 이력 3건').getAttribute('aria-expanded')).toBe('false');
    expect(getRepositoryHistory).not.toHaveBeenCalled();
  });

  it('변경 이력은 접혀 있고 펼칠 때 첫 쪽을 읽으며, 저장하면 다시 읽는다', async () => {
    saveRepositoryUrl.mockResolvedValue({
      repositoryUrl: 'https://github.com/synthetic/b',
      canEditRepositoryUrl: true,
    });
    await render();
    const trigger = button('변경 이력');
    expect(trigger.closest('section')).toBe(repositoryCard());
    expect(
      container.querySelector('[role="region"]')?.textContent,
    ).not.toContain('변경 이력');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(getRepositoryHistory).not.toHaveBeenCalled();

    await act(async () => trigger.click());
    expect(getRepositoryHistory).toHaveBeenCalledExactlyOnceWith(
      'program-1',
      'team-1',
    );
    expect(container.textContent).toContain('저장소 URL 변경 이력이 없습니다.');
    expect(trigger.textContent).toBe('변경 이력 0건');

    vi.mocked(getRepositoryHistory).mockResolvedValue({
      items: [repositoryChange],
      nextCursor: null,
    });
    await changeUrlTo('https://github.com/synthetic/b');
    expect(getRepositoryHistory).toHaveBeenCalledTimes(2);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.textContent).toBe('변경 이력 1건');
    const row = repositoryCard()?.querySelector('ol li');
    expect(row?.textContent).toBe(
      '2026년 9월 1일 · @synthetic-leader · synthetic/a → synthetic/b',
    );
    expect(row?.querySelector('time')?.getAttribute('datetime')).toBe(
      repositoryChange.occurredAt,
    );
  });

  it('부분 이력은 건수를 내지 않고 마지막 쪽까지 읽으면 전체 건수를 보인다', async () => {
    vi.mocked(getRepositoryHistory)
      .mockResolvedValueOnce({ items: [repositoryChange], nextCursor: 'next' })
      .mockResolvedValueOnce({
        items: [
          {
            ...repositoryChange,
            id: 'audit-0',
            previousRepositoryUrl: null,
            newRepositoryUrl: linkedRepository.url,
          },
        ],
        nextCursor: null,
      });
    await render();
    const trigger = button('변경 이력');
    await act(async () => trigger.click());
    expect(trigger.textContent).toBe('변경 이력');

    await act(async () => button('변경 이력 더 보기').click());
    expect(trigger.textContent).toBe('변경 이력 2건');
    expect(
      repositoryCard()?.querySelector('ol li:last-child')?.textContent,
    ).toContain('없음 → synthetic/a');
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
