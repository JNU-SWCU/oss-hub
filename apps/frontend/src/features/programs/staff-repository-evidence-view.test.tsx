// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffRepositoryEvidenceView } from './staff-repository-evidence-view';
import {
  getRepositoryHistory,
  type RepositoryHistoryPage,
  type StaffRepositoryEvidence,
} from './staff-repository-evidence';

vi.mock('./staff-repository-evidence', async (original) => ({
  ...(await original<typeof import('./staff-repository-evidence')>()),
  getRepositoryHistory: vi.fn(),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/** 끝나는 시점을 테스트가 잡는 요청. */
function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('staff repository evidence view', () => {
  let container: HTMLDivElement;
  let root: Root;
  const history = {
    id: 'audit-1',
    occurredAt: '2026-09-01T00:00:00.000Z',
    actorGithubLogin: 'synthetic-author',
    previousRepositoryUrl: 'https://github.com/synthetic/old',
    newRepositoryUrl: 'https://github.com/synthetic/current',
  };
  const evidence: StaffRepositoryEvidence = {
    repositoryContributions: {
      repositoryId: 'repo-1',
      repositoryUrl: history.newRepositoryUrl,
      window: { from: '2026-01-01', to: '2026-12-31', timeZone: 'Asia/Seoul' },
      collectionStatus: 'COLLECTED',
      lastSuccessAt: null,
      members: [
        {
          userId: 'user-1',
          githubId: '101',
          commitCount: 2,
          pullRequestCount: 3,
          releaseCount: 1,
          hasObservations: true,
        },
      ],
      unmatchedContributors: [
        {
          githubId: '999',
          commitCount: 7,
          pullRequestCount: 0,
          releaseCount: 0,
        },
      ],
    },
    repositoryUrlHistory: { items: [history], nextCursor: 'next' },
  };
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
  async function render(overrides?: {
    readonly evidence?: StaffRepositoryEvidence;
    readonly programId?: string;
    readonly teamId?: string;
  }) {
    await act(async () =>
      root.render(
        <StaffRepositoryEvidenceView
          evidence={overrides?.evidence ?? evidence}
          members={[
            {
              userId: 'user-1',
              nickname: 'synthetic-member',
              name: null,
              isLeader: true,
            },
          ]}
          programId={overrides?.programId ?? 'program-1'}
          teamId={overrides?.teamId ?? 'team-1'}
        />,
      ),
    );
  }
  it('shows current member metrics separately from unmatched identities', async () => {
    // Given / When
    await render();
    // Then
    const members = container.querySelector('[aria-label="팀원별 활동"]');
    expect(members?.textContent).toContain('@synthetic-member');
    expect(members?.textContent).toContain('커밋 2 · PR 3 · 릴리스 1');
    expect(members?.textContent).not.toContain('999');
    expect(container.textContent).toContain('GitHub ID 999 · 커밋 7');
    expect(container.textContent).toContain(history.previousRepositoryUrl);
    expect(container.textContent).toContain(history.newRepositoryUrl);
    expect(container.textContent).toContain(history.actorGithubLogin);
    expect(container.textContent).not.toContain('변경 사유');
  });
  it('labels lastSuccessAt as the last successful collection, not a generic as-of time', async () => {
    // Given
    const lastSuccessAt = '2026-09-01T00:00:00.000Z';
    const activity = evidence.repositoryContributions;
    if (activity === null) throw new Error('fixture contributions required');
    // When
    await render({
      evidence: {
        ...evidence,
        repositoryContributions: { ...activity, lastSuccessAt },
      },
    });
    // Then
    expect(container.textContent).toContain('마지막 성공 수집:');
    expect(container.textContent).toContain(
      new Date(lastSuccessAt).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
      }),
    );
    expect(container.textContent).not.toContain('마지막 수집:');
  });
  it('preserves prose word boundaries and keeps history timestamps separate from handles', async () => {
    // Given / When
    await render();
    // Then
    expect(container.firstElementChild?.className).toContain('break-keep');
    expect(container.querySelector('ol time')?.className).toContain(
      'whitespace-nowrap',
    );
    expect(
      container.querySelector('ol time')?.parentElement?.className,
    ).not.toContain('break-all');
  });
  it('appends the next history page and removes exhausted pagination', async () => {
    // Given
    vi.mocked(getRepositoryHistory).mockResolvedValue({
      items: [{ ...history, id: 'audit-2', actorGithubLogin: 'earlier-actor' }],
      nextCursor: null,
    });
    await render();
    // When
    await act(async () => container.querySelector('button')?.click());
    // Then
    expect(getRepositoryHistory).toHaveBeenCalledWith(
      'program-1',
      'team-1',
      'next',
    );
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelector('button')).toBeNull();
  });
  it('keeps visible history and retry action when loading more fails', async () => {
    // Given
    vi.mocked(getRepositoryHistory).mockRejectedValue(
      new Error('Synthetic failure'),
    );
    await render();
    // When
    await act(async () => container.querySelector('button')?.click());
    // Then
    expect(container.querySelectorAll('ol li')).toHaveLength(1);
    expect(container.querySelector('button')?.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('shows the new team history immediately and ignores a late previous page', async () => {
    // Given
    const pending = deferred<RepositoryHistoryPage>();
    vi.mocked(getRepositoryHistory).mockReturnValueOnce(pending.promise);
    await render();
    await act(async () => container.querySelector('button')?.click());
    expect(container.querySelector('button')?.disabled).toBe(true);
    expect(container.querySelector('button')?.textContent).toContain(
      '불러오는 중',
    );
    const other = {
      ...history,
      id: 'audit-other',
      actorGithubLogin: 'other-team-actor',
    };
    // When
    await render({
      evidence: {
        repositoryContributions: null,
        repositoryUrlHistory: { items: [other], nextCursor: 'other-next' },
      },
      teamId: 'team-2',
    });
    // Then
    expect(container.textContent).toContain('other-team-actor');
    expect(container.textContent).not.toContain(history.actorGithubLogin);
    expect(container.textContent).toContain('활동을 표시할 저장소가 없습니다.');
    expect(container.querySelectorAll('ol li')).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('button')?.disabled).toBe(false);
    expect(container.querySelector('button')?.textContent).toContain(
      '변경 이력 더 보기',
    );
    await act(async () => {
      pending.resolve({
        items: [
          { ...history, id: 'audit-2', actorGithubLogin: 'earlier-actor' },
        ],
        nextCursor: null,
      });
      await pending.promise;
    });
    expect(container.textContent).not.toContain('earlier-actor');
    expect(container.textContent).not.toContain(history.actorGithubLogin);
    expect(container.querySelectorAll('ol li')).toHaveLength(1);
    expect(getRepositoryHistory).toHaveBeenCalledTimes(1);
    vi.mocked(getRepositoryHistory).mockResolvedValueOnce({
      items: [
        {
          ...other,
          id: 'audit-other-2',
          actorGithubLogin: 'older-other-actor',
        },
      ],
      nextCursor: null,
    });
    await act(async () => container.querySelector('button')?.click());
    expect(getRepositoryHistory).toHaveBeenLastCalledWith(
      'program-1',
      'team-2',
      'other-next',
    );
    expect(container.textContent).toContain('older-other-actor');
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });
  it('discards a failed page request when the program changes', async () => {
    // Given
    vi.mocked(getRepositoryHistory).mockRejectedValue(
      new Error('Synthetic failure'),
    );
    await render();
    await act(async () => container.querySelector('button')?.click());
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    // When
    await render({
      evidence: {
        ...evidence,
        repositoryUrlHistory: {
          items: [
            {
              ...history,
              id: 'audit-other',
              actorGithubLogin: 'other-program-actor',
            },
          ],
          nextCursor: 'other-next',
        },
      },
      programId: 'program-2',
    });
    // Then
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('other-program-actor');
    expect(container.textContent).not.toContain(history.actorGithubLogin);
    expect(container.querySelector('button')?.disabled).toBe(false);
  });
  it('keeps same-team pagination when parent evidence rerenders', async () => {
    // Given
    const activity = evidence.repositoryContributions;
    if (activity === null) throw new Error('fixture contributions required');
    vi.mocked(getRepositoryHistory).mockResolvedValue({
      items: [{ ...history, id: 'audit-2', actorGithubLogin: 'earlier-actor' }],
      nextCursor: null,
    });
    await render();
    await act(async () => container.querySelector('button')?.click());
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    // When
    await render({
      evidence: {
        repositoryContributions: {
          ...activity,
          collectionStatus: 'ERROR',
        },
        repositoryUrlHistory: { items: [history], nextCursor: 'next' },
      },
    });
    // Then
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.textContent).toContain('earlier-actor');
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toContain(
      '최근 수집에 실패했습니다. 마지막으로 수집된 활동을 표시합니다.',
    );
  });
});
