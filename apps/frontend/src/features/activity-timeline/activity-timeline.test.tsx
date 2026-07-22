import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';
import { fetchActivityTimeline } from './api';
import { ActivityChart } from './components/activity-chart';
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

function stubTimelineResponse(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

describe('activity timeline', () => {
  it('granularity를 current-user API query로 전달한다', async () => {
    const yearlyTimeline: ActivityTimeline = {
      ...timeline,
      series: {
        granularity: 'YEAR',
        points: [{ ...timeline.series.points[0], period: '2026' }],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(yearlyTimeline), {
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
    expect(html).toContain('참여 프로그램 정보를 불러오지 못했습니다');
    expect(html).not.toContain('참여한 프로그램이 없습니다');
  });

  it('성공 응답 본문을 활동 타임라인 계약으로 해석한다', async () => {
    stubTimelineResponse(timeline);

    await expect(fetchActivityTimeline('MONTH')).resolves.toEqual(timeline);
  });

  it.each([
    [
      'invalid granularity',
      { ...timeline, series: { ...timeline.series, granularity: 'WEEK' } },
    ],
    ['non-array programs', { ...timeline, programs: {} }],
    [
      'invalid month period',
      {
        ...timeline,
        series: {
          ...timeline.series,
          points: [{ ...timeline.series.points[0], period: '2026' }],
        },
      },
    ],
    [
      'negative metric',
      {
        ...timeline,
        series: {
          ...timeline.series,
          points: [{ ...timeline.series.points[0], commitCount: -1 }],
        },
      },
    ],
    [
      'fractional metric',
      {
        ...timeline,
        series: {
          ...timeline.series,
          points: [{ ...timeline.series.points[0], prCount: 1.5 }],
        },
      },
    ],
    [
      'inconsistent total',
      {
        ...timeline,
        series: {
          ...timeline.series,
          points: [{ ...timeline.series.points[0], total: 0 }],
        },
      },
    ],
    [
      'unknown applicationMode',
      {
        ...timeline,
        programs: [{ ...timeline.programs[0], applicationMode: 'GROUP' }],
      },
    ],
  ])('성공 응답 본문이 malformed이면 거부한다: %s', async (_label, body) => {
    stubTimelineResponse(body);

    await expect(fetchActivityTimeline('MONTH')).rejects.toThrow(
      '활동 타임라인 응답 형식이 올바르지 않습니다',
    );
  });

  it('차트 데이터를 스크린 리더용 표로도 제공하고 시각 차트는 숨긴다', () => {
    const html = renderToStaticMarkup(
      <ActivityChart points={timeline.series.points} />,
    );

    expect(html).toContain('<table class="sr-only">');
    expect(html).toContain(
      '<th scope="col">기간</th><th scope="col">커밋</th><th scope="col">Pull Request</th><th scope="col">Star</th><th scope="col">합계</th>',
    );
    expect(html).toContain(
      '<th scope="row">2026-01</th><td>12</td><td>3</td><td>1</td><td>16</td>',
    );
    expect(html).toContain(
      '<div aria-hidden="true" class="h-80 min-h-80 w-full overflow-hidden">',
    );
  });

  it('연도별 응답에서 월 형식 period를 거부한다', async () => {
    stubTimelineResponse({
      ...timeline,
      series: { ...timeline.series, granularity: 'YEAR' },
    });

    await expect(fetchActivityTimeline('YEAR')).rejects.toThrow(
      '활동 타임라인 응답 형식이 올바르지 않습니다',
    );
  });

  it.each([
    ['YEAR', timeline],
    [
      'MONTH',
      {
        ...timeline,
        series: {
          granularity: 'YEAR',
          points: [{ ...timeline.series.points[0], period: '2026' }],
        },
      },
    ],
  ] as const)(
    '요청한 %s granularity와 다른 성공 응답을 거부한다',
    async (requestedGranularity, response) => {
      stubTimelineResponse(response);

      await expect(fetchActivityTimeline(requestedGranularity)).rejects.toThrow(
        '활동 타임라인 응답 형식이 올바르지 않습니다',
      );
    },
  );
});
