// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  ActivityGraphContent,
  ActivityPanelBody,
} from './activity-graph-panel';
import { getProgramActivity } from '../api';

vi.mock('../api', () => ({ getProgramActivity: vi.fn() }));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('활동 그래프 지표 비교', () => {
  it.each(['own-application', 'missing-application'])(
    '우리 팀은 신청 ID %s의 활동만 표시하고 다른 팀으로 대체하지 않는다',
    async (applicationId) => {
      vi.mocked(getProgramActivity).mockResolvedValue(
        ['own-application', 'other-application'].map((id) => ({
          applicationId: id,
          label: id === 'own-application' ? '우리 팀' : '다른 팀',
          commitCount: id === 'own-application' ? 7 : 999,
          pullRequestCount: 2,
          releaseCount: 0,
          collectionStatus: 'READY',
          dataAsOf: null,
          lastActivityAt: null,
          members: [],
          hasIncompleteContributions: false,
        })),
      );
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () =>
          root.render(
            <ActivityGraphContent
              programId="program"
              applicationId={applicationId}
            />,
          ),
        );
        expect(container.textContent).not.toContain('다른 팀');
        expect(container.textContent).not.toContain('999');
        expect(container.querySelector('[role="meter"]')).toBeNull();
        expect(container.textContent).not.toContain('최댓값');
        if (applicationId === 'own-application') {
          expect(container.querySelector('strong')?.textContent).toBe(
            '우리 팀',
          );
          expect(container.querySelector('dd')?.textContent).toBe('7');
        } else {
          expect(container.querySelector('strong')).toBeNull();
          expect(container.textContent).toContain('우리 팀의 활동이 집계되면');
        }
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    },
  );

  it('같은 지표의 최댓값을 기준으로 각각의 막대를 그리고 0은 채우지 않는다', () => {
    const activities = [
      {
        applicationId: 'a',
        label: '팀 A',
        commitCount: 40,
        pullRequestCount: 2,
        releaseCount: 0,
      },
      {
        applicationId: 'b',
        label: '팀 B',
        commitCount: 20,
        pullRequestCount: 4,
        releaseCount: 1,
      },
    ].map((activity) => ({
      ...activity,
      dataAsOf: null,
      lastActivityAt: null,
      collectionStatus: 'READY' as const,
      members:
        activity.applicationId === 'a'
          ? [
              {
                githubLogin: 'alice',
                commitCount: 40,
                pullRequestCount: 2,
                releaseCount: 0,
              },
              {
                githubLogin: 'zero',
                commitCount: 0,
                pullRequestCount: 0,
                releaseCount: 0,
              },
            ]
          : [],
      hasIncompleteContributions: false,
    }));

    const html = renderToStaticMarkup(
      <ActivityPanelBody
        state={{ kind: 'ready', activities }}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('같은 지표의 최댓값');
    expect(html.match(/role="meter"/g)).toHaveLength(6);
    expect(html).toContain('width:50%');
    expect(html).toContain('width:0%');
    expect(html).toContain('팀원별 기여 (2명)');
    expect(html).toContain('@zero');
    expect(html).toContain('아직 기여 없음');
  });
});
