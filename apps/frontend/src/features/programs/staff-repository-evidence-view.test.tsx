// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffRepositoryEvidenceView } from './staff-repository-evidence-view';
import {
  getRepositoryHistory,
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

describe('staff repository evidence view', () => {
  let container: HTMLDivElement;
  let root: Root;
  const history = {
    id: 'audit-1',
    occurredAt: '2026-09-01T00:00:00.000Z',
    actorGithubLogin: 'synthetic-author',
    previousRepositoryUrl: 'https://github.com/synthetic/old',
    newRepositoryUrl: 'https://github.com/synthetic/current',
    reason: 'Project moved\nPreserve project history',
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
  async function render() {
    await act(async () =>
      root.render(
        <StaffRepositoryEvidenceView
          evidence={evidence}
          members={[
            {
              userId: 'user-1',
              nickname: 'synthetic-member',
              name: null,
              isLeader: true,
            },
          ]}
          programId="program-1"
          teamId="team-1"
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
    expect(container.textContent).toContain(history.reason);
    const reason = Array.from(container.querySelectorAll('dd')).find(
      (element) => element.textContent === history.reason,
    );
    expect(reason?.className).toContain('whitespace-pre-wrap');
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
      items: [{ ...history, id: 'audit-2', reason: 'Earlier change' }],
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
});
