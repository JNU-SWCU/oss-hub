import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ActivityPanelBody } from './activity-graph-panel';

describe('활동 그래프 지표 비교', () => {
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
      members: [],
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
  });
});
