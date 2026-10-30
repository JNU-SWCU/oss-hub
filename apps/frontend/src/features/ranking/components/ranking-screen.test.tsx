import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankingPage, RankingTimeline } from '../types';
import type { RankingTimelineState, RankingViewState } from './ranking-view';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const api = vi.hoisted(() => ({
  getRanking: vi.fn(),
  getRankingTimeline: vi.fn(),
  downloadTextFile: vi.fn(),
}));

vi.mock('../api', () => ({
  getRanking: api.getRanking,
  getRankingTimeline: api.getRankingTimeline,
}));
vi.mock('../csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../csv')>();
  return { ...actual, downloadTextFile: api.downloadTextFile };
});

const route = vi.hoisted(() => ({ query: 'year=2026' }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(route.query),
}));

const captured = vi.hoisted(() => ({
  props: null as {
    readonly state: RankingViewState;
    readonly timeline?: RankingTimelineState;
    readonly onExportCsv: () => void;
  } | null,
}));

vi.mock('./ranking-view', () => ({
  RankingView: (props: {
    readonly state: RankingViewState;
    readonly timeline?: RankingTimelineState;
    readonly onExportCsv: () => void;
  }) => {
    captured.props = props;
    return null;
  },
}));

import { RankingScreen } from './ranking-screen';

const staffPage: RankingPage = {
  year: 2026,
  items: [
    {
      rank: 1,
      displayName: 'synthetic-top',
      githubLogin: 'synthetic-top',
      name: 'synthetic-staff-name',
      department: null,
      commitCount: 1,
      pullRequestCount: 0,
      issueCount: 0,
      repositoryCount: 1,
      starCount: 0,
      total: 2,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  dataAsOf: null,
  viewerClass: 'staff',
  nextCycleAt: '2026-08-21T00:00:00.000Z',
};

const timelinePayload: RankingTimeline = {
  year: 2026,
  viewerClass: 'staff',
  viewerGithubLogin: 'synthetic-top',
  dataAsOf: null,
  points: [{ date: '2026-08-19', starEstimated: false }],
  series: [{ githubLogin: 'synthetic-top', ranks: [1], totals: [2] }],
};

describe('RankingScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    captured.props = null;
    route.query = 'year=2026';
    api.getRanking.mockReset().mockResolvedValue(staffPage);
    api.getRankingTimeline.mockReset().mockResolvedValue(timelinePayload);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('page fetch 의 nextCycleAt 을 발행하고 unmount 때 null 로 지운다', async () => {
    const onNextCycleAt = vi.fn();
    await act(async () => {
      root.render(<RankingScreen onNextCycleAt={onNextCycleAt} />);
    });

    expect(api.getRanking).toHaveBeenCalledWith(
      2026,
      1,
      100,
      expect.any(AbortSignal),
    );
    expect(onNextCycleAt).toHaveBeenCalledWith('2026-08-21T00:00:00.000Z');

    await act(async () => root.unmount());
    expect(onNextCycleAt).toHaveBeenLastCalledWith(null);
    root = createRoot(container);
  });

  it('CSV 는 첫 응답의 total 만큼 pageSize=100으로 각 페이지를 한 번씩 가져온다', async () => {
    const firstPageItems = Array.from({ length: 100 }, (_, index) => ({
      ...staffPage.items[0],
      rank: index + 1,
      githubLogin: `synthetic-${index + 1}`,
    }));
    const pageTwo = {
      ...staffPage,
      page: 2,
      items: [
        { ...staffPage.items[0], rank: 101, githubLogin: 'synthetic-101' },
      ],
    };
    api.getRanking
      .mockReset()
      .mockResolvedValueOnce(staffPage)
      .mockResolvedValueOnce({
        ...staffPage,
        items: firstPageItems,
        pageSize: 100,
        total: 101,
      })
      .mockResolvedValueOnce(pageTwo);

    await act(async () => {
      root.render(<RankingScreen onNextCycleAt={() => undefined} />);
    });
    await act(async () => captured.props?.onExportCsv());

    expect(api.getRanking).toHaveBeenNthCalledWith(2, 2026, 1, 100);
    expect(api.getRanking).toHaveBeenNthCalledWith(3, 2026, 2, 100);
    expect(api.downloadTextFile).toHaveBeenCalledWith(
      'ranking-2026.csv',
      expect.stringContaining('\uFEFFrank,name,githubLogin'),
    );
  });

  it('total=0이면 빈 CSV를 다운로드한다', async () => {
    api.getRanking
      .mockReset()
      .mockResolvedValueOnce(staffPage)
      .mockResolvedValueOnce({
        ...staffPage,
        items: [],
        pageSize: 100,
        total: 0,
      });
    await act(async () =>
      root.render(<RankingScreen onNextCycleAt={() => undefined} />),
    );
    api.downloadTextFile.mockReset();
    await act(async () => captured.props?.onExportCsv());
    expect(api.downloadTextFile).toHaveBeenCalledWith(
      'ranking-2026.csv',
      expect.stringContaining('\uFEFFrank,name,githubLogin'),
    );
  });

  it('광고된 total보다 수집된 항목이 적으면 CSV를 다운로드하지 않는다', async () => {
    api.getRanking
      .mockReset()
      .mockResolvedValueOnce(staffPage)
      .mockResolvedValueOnce({ ...staffPage, pageSize: 100, total: 2 })
      .mockResolvedValueOnce({
        ...staffPage,
        page: 2,
        pageSize: 100,
        total: 2,
        items: [],
      });
    await act(async () =>
      root.render(<RankingScreen onNextCycleAt={() => undefined} />),
    );
    api.downloadTextFile.mockReset();
    await act(async () => captured.props?.onExportCsv());
    expect(api.downloadTextFile).not.toHaveBeenCalled();
  });

  it('연도보기에서는 숫자 연도로 타임라인을 한 번 가져온다', async () => {
    await act(async () =>
      root.render(<RankingScreen onNextCycleAt={() => undefined} />),
    );

    expect(api.getRankingTimeline).toHaveBeenCalledWith(
      2026,
      expect.any(AbortSignal),
    );
    expect(captured.props?.timeline).toEqual({
      kind: 'ready',
      timeline: timelinePayload,
    });
  });

  it('전기간 보기에선 타임라인을 아예 요구하지 않는다', async () => {
    route.query = 'year=all';
    await act(async () =>
      root.render(<RankingScreen onNextCycleAt={() => undefined} />),
    );

    expect(api.getRankingTimeline).not.toHaveBeenCalled();
    expect(captured.props?.timeline).toBeUndefined();
  });

  it('2026보다 이전 해엔 타임라인을 요구하지 않는다', async () => {
    route.query = 'year=2025';
    await act(async () =>
      root.render(<RankingScreen onNextCycleAt={() => undefined} />),
    );

    expect(api.getRankingTimeline).not.toHaveBeenCalled();
    expect(captured.props?.timeline).toBeUndefined();
  });

  it('타임라인이 실패해도 순위표는 그대로 남는다', async () => {
    api.getRankingTimeline
      .mockReset()
      .mockRejectedValue(new Error('timeline failed'));

    await act(async () =>
      root.render(<RankingScreen onNextCycleAt={() => undefined} />),
    );

    expect(captured.props?.timeline).toEqual({ kind: 'error' });
    expect(captured.props?.state.kind).toBe('ready');
  });

  it('페이지 실패에서는 CSV를 다운로드하지 않는다', async () => {
    api.getRanking.mockReset().mockRejectedValue(new Error('page failed'));
    await act(async () =>
      root.render(<RankingScreen onNextCycleAt={() => undefined} />),
    );
    api.downloadTextFile.mockReset();
    await act(async () => {
      captured.props?.onExportCsv();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.downloadTextFile).not.toHaveBeenCalled();
  });
});
