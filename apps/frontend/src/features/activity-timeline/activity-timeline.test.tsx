import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';
import { fetchActivityTimeline } from './api';
import { orderActivityPoints } from './activity-point-order';
import { ActivityChart } from './components/activity-chart';
import { ActivityTimelineView } from './components/activity-timeline-view';
import type { ActivityTimeline } from './types';

/**
 * 선 위의 몸통과 내부 표현을 갈라 둔다.
 *
 * 하나로 뭉쳐 두면 픽스처가 내부 이름을 쓰는 순간 파서가 선 위의 이름을
 * 안 읽어도 테스트가 통과한다 — #729 의 회귀가 정확히 그 통로로 새어나갔다.
 */
const wireTimeline = {
  dataAsOf: '2026-08-01T00:00:00.000Z',
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
        // 백엔드 DTO 의 이름이다(`ActivityPointResponseDto`).
        pullRequestCount: 3,
        releaseCount: 1,
        total: 16,
      },
    ],
  },
};

const timeline: ActivityTimeline = {
  dataAsOf: wireTimeline.dataAsOf,
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
        releaseCount: 1,
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
  it('그래프는 과거부터, 표는 최근부터 기간을 정렬한다', () => {
    const points = [
      { ...timeline.series.points[0], period: '2026-07' },
      { ...timeline.series.points[0], period: '2025-12' },
      { ...timeline.series.points[0], period: '2026-01' },
    ];

    const ordered = orderActivityPoints(points);

    expect(ordered.chart.map((point) => point.period)).toEqual([
      '2025-12',
      '2026-01',
      '2026-07',
    ]);
    expect(ordered.table.map((point) => point.period)).toEqual([
      '2026-07',
      '2026-01',
      '2025-12',
    ]);
    expect(points.map((point) => point.period)).toEqual([
      '2026-07',
      '2025-12',
      '2026-01',
    ]);
  });

  it('granularity를 current-user API query로 전달한다', async () => {
    // 응답 몸통이므로 선 위의 형태여야 한다.
    const yearlyTimeline = {
      ...wireTimeline,
      series: {
        granularity: 'YEAR',
        points: [{ ...wireTimeline.series.points[0], period: '2026' }],
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
    expect(html).toContain('Release');
    expect(html).toContain('데이터 기준 시각');
    expect(html).toMatch(
      /<time dateTime="2026-08-01T00:00:00\.000Z">[^<]+<\/time>/,
    );
    expect(html).not.toContain('Star');
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

  it('수집 전 상태와 수집 후 활동 없음 상태를 구분한다', () => {
    const beforeCollection = renderToStaticMarkup(
      <ActivityTimelineView
        data={{
          ...timeline,
          dataAsOf: null,
          series: { ...timeline.series, points: [] },
        }}
        granularity="MONTH"
        status="success"
        onGranularityChange={() => undefined}
        onRetry={() => undefined}
      />,
    );
    const noActivity = renderToStaticMarkup(
      <ActivityTimelineView
        data={{ ...timeline, series: { ...timeline.series, points: [] } }}
        granularity="MONTH"
        status="success"
        onGranularityChange={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(beforeCollection).toContain(
      '활동 데이터를 아직 수집하지 않았습니다',
    );
    expect(noActivity).toContain('아직 활동 기록이 없습니다');
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

  it('선 위의 pullRequestCount 를 내부 prCount 로 옮긴다', async () => {
    // 백엔드 DTO 는 `pullRequestCount` 를 낸다. 픽스처가 내부 이름을 쓰고 있으면
    // 파서가 선 위의 이름을 안 읽어도 테스트가 통과한다 — #729 의 회귀가
    // 정확히 그렇게 통과했고 프로덕션에서만 화면이 통째로 에러였다.
    stubTimelineResponse(wireTimeline);

    await expect(fetchActivityTimeline('MONTH')).resolves.toEqual(timeline);
  });

  it.each([
    [
      'invalid granularity',
      {
        ...wireTimeline,
        series: { ...wireTimeline.series, granularity: 'WEEK' },
      },
    ],
    ['non-array programs', { ...wireTimeline, programs: {} }],
    [
      'invalid month period',
      {
        ...wireTimeline,
        series: {
          ...wireTimeline.series,
          points: [{ ...wireTimeline.series.points[0], period: '2026' }],
        },
      },
    ],
    [
      'negative metric',
      {
        ...wireTimeline,
        series: {
          ...wireTimeline.series,
          points: [{ ...wireTimeline.series.points[0], commitCount: -1 }],
        },
      },
    ],
    [
      'fractional metric',
      {
        ...wireTimeline,
        series: {
          ...wireTimeline.series,
          points: [{ ...wireTimeline.series.points[0], pullRequestCount: 1.5 }],
        },
      },
    ],
    [
      'legacy star metric',
      {
        ...wireTimeline,
        series: {
          ...wireTimeline.series,
          points: [
            {
              period: '2026-01',
              commitCount: 12,
              pullRequestCount: 3,
              starCount: 1,
              total: 16,
            },
          ],
        },
      },
    ],
    [
      'inconsistent total',
      {
        ...wireTimeline,
        series: {
          ...wireTimeline.series,
          points: [{ ...wireTimeline.series.points[0], total: 0 }],
        },
      },
    ],
    [
      'unknown applicationMode',
      {
        ...wireTimeline,
        programs: [{ ...wireTimeline.programs[0], applicationMode: 'GROUP' }],
      },
    ],
    ['invalid dataAsOf', { ...wireTimeline, dataAsOf: 'not-a-date' }],
  ])('성공 응답 본문이 malformed이면 거부한다: %s', async (_label, body) => {
    stubTimelineResponse(body);

    await expect(fetchActivityTimeline('MONTH')).rejects.toThrow(
      '활동 타임라인 응답 형식이 올바르지 않습니다',
    );
  });

  it('차트 데이터를 화면에 보이는 표로도 제공하고 시각 차트는 스크린 리더에서 숨긴다', () => {
    const html = renderToStaticMarkup(
      <ActivityChart points={timeline.series.points} />,
    );

    expect(html).toContain('<table');
    expect(html).not.toContain('<table class="sr-only">');
    expect(html).toContain('scope="col">기간</th>');
    expect(html).toContain('scope="col">커밋</th>');
    expect(html).toContain('scope="row">2026-01</th>');
    expect(html).toContain('text-right">12</td>');
    expect(html).toContain(
      '<div aria-hidden="true" class="h-80 min-h-80 w-full overflow-hidden">',
    );
  });

  it('연도별 응답에서 월 형식 period를 거부한다', async () => {
    stubTimelineResponse({
      ...wireTimeline,
      series: { ...wireTimeline.series, granularity: 'YEAR' },
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
        ...wireTimeline,
        series: {
          granularity: 'YEAR',
          points: [{ ...wireTimeline.series.points[0], period: '2026' }],
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
