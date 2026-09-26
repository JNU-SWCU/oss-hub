// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryUrlHistory } from './repository-url-history';
import { getRepositoryHistory } from './team-activity-api';

vi.mock('./team-activity-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./team-activity-api')>()),
  getRepositoryHistory: vi.fn(),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const change = {
  id: 'audit-1',
  occurredAt: '2026-09-01T00:00:00.000Z',
  actorGithubLogin: 'synthetic-author',
  previousRepositoryUrl: 'https://github.com/synthetic/old',
  newRepositoryUrl: 'https://github.com/synthetic/current',
};

describe('RepositoryUrlHistory', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(getRepositoryHistory).mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  async function render() {
    await act(async () =>
      root.render(
        <RepositoryUrlHistory programId="program-1" teamId="team-1" />,
      ),
    );
  }
  function button(): HTMLButtonElement | null {
    return container.querySelector('button');
  }

  it('누가·언제·무엇에서 무엇으로 바꿨는지 보이고 사유 칸은 없다', async () => {
    vi.mocked(getRepositoryHistory).mockResolvedValue({
      items: [change],
      nextCursor: null,
    });
    await render();
    expect(getRepositoryHistory).toHaveBeenCalledExactlyOnceWith(
      'program-1',
      'team-1',
    );
    expect(container.textContent).toContain('@synthetic-author');
    expect(container.textContent).toContain('2026년 9월 1일 09:00');
    expect(container.textContent).toContain(change.previousRepositoryUrl);
    expect(container.textContent).toContain(change.newRepositoryUrl);
    expect(container.textContent).not.toContain('변경 사유');
    expect(container.firstElementChild?.className).toContain('break-keep');
    const time = container.querySelector('ol time');
    expect(time?.getAttribute('datetime')).toBe(change.occurredAt);
    expect(time?.className).toContain('whitespace-nowrap');
    expect(button()).toBeNull();
  });

  it('이력이 없으면 없다고 말한다', async () => {
    vi.mocked(getRepositoryHistory).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    await render();
    expect(container.textContent).toContain('저장소 URL 변경 이력이 없습니다.');
  });

  it('첫 쪽을 못 읽으면 빈 이력으로 접지 않고 다시 시도하게 한다', async () => {
    vi.mocked(getRepositoryHistory)
      .mockRejectedValueOnce(new Error('Synthetic failure'))
      .mockResolvedValueOnce({ items: [change], nextCursor: null });
    await render();
    expect(container.textContent).toContain(
      '저장소 URL 변경 이력을 불러오지 못했습니다',
    );
    expect(container.textContent).not.toContain('이력이 없습니다');
    await act(async () => button()?.click());
    expect(container.textContent).toContain('@synthetic-author');
  });

  it('다음 쪽을 이어 붙이고 끝나면 더 보기를 거둔다', async () => {
    vi.mocked(getRepositoryHistory)
      .mockResolvedValueOnce({ items: [change], nextCursor: 'next' })
      .mockResolvedValueOnce({
        items: [
          { ...change, id: 'audit-2', actorGithubLogin: 'earlier-actor' },
        ],
        nextCursor: null,
      });
    await render();
    expect(button()?.textContent).toBe('변경 이력 더 보기');
    await act(async () => button()?.click());
    expect(getRepositoryHistory).toHaveBeenLastCalledWith(
      'program-1',
      'team-1',
      'next',
    );
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(button()).toBeNull();
  });

  it('더 보기가 실패해도 보이던 이력과 다시 누를 버튼을 남긴다', async () => {
    vi.mocked(getRepositoryHistory)
      .mockResolvedValueOnce({ items: [change], nextCursor: 'next' })
      .mockRejectedValueOnce(new Error('Synthetic failure'));
    await render();
    await act(async () => button()?.click());
    expect(container.querySelectorAll('ol li')).toHaveLength(1);
    expect(button()?.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '이력 조회 실패',
    );
  });
});
