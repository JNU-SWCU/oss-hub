import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';
import { fetchActivityTimeline } from './api';
import { ActivityTimelineView } from './components/activity-timeline-view';
import type { ActivityTimeline } from './types';

const timeline: ActivityTimeline = {
  programs: [
    {
      programId: 'program-1',
      programName: '캡스톤 2026',
      year: 2026,
      applicationMode: 'PERSONAL',
    },
  ],
  series: {
    granularity: 'MONTH',
    points: [
      {
        period: '2026-01',
        commitCount: 12,
        prCount: 3,
        starCount: 1,
        total: 16,
      },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('activity timeline', () => {
  it('granularity를 current-user API query로 전달한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(timeline), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchActivityTimeline('YEAR');

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('dashboard/student/activity-timeline?granularity=YEAR'),
      undefined,
    );
  });

  it('성공 상태에 프로그램, 기간 전환, 활동 지표를 표시한다', () => {
    const html = renderToStaticMarkup(
      <ActivityTimelineView
        data={timeline}
        granularity="MONTH"
        status="success"
        onGranularityChange={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(html).toContain('캡스톤 2026');
    expect(html).toContain('월별');
    expect(html).toContain('연도별');
    expect(html).toContain('커밋');
    expect(html).toContain('Pull Request');
    expect(html).toContain('Star');
    expect(html).not.toContain('FORCE');
  });

  it('활동이 비어도 참여 프로그램은 유지한다', () => {
    const html = renderToStaticMarkup(
      <ActivityTimelineView
        data={{ ...timeline, series: { ...timeline.series, points: [] } }}
        granularity="MONTH"
        status="success"
        onGranularityChange={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(html).toContain('아직 활동 기록이 없습니다');
    expect(html).toContain('캡스톤 2026');
  });

  it('오류 상태에 alert와 재시도 명령을 표시한다', () => {
    const html = renderToStaticMarkup(
      <ActivityTimelineView
        data={null}
        granularity="MONTH"
        status="error"
        onGranularityChange={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('다시 시도');
  });
});
