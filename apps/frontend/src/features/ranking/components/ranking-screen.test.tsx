// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankingPage } from '../types';
import type { RankingViewState } from './ranking-view';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const api = vi.hoisted(() => ({
  getRanking: vi.fn(),
  downloadTextFile: vi.fn(),
}));

vi.mock('../api', () => ({ getRanking: api.getRanking }));
vi.mock('../csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../csv')>();
  return { ...actual, downloadTextFile: api.downloadTextFile };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('year=2026'),
}));

const captured = vi.hoisted(() => ({
  props: null as {
    readonly state: RankingViewState;
    readonly onExportCsv: () => void;
  } | null,
}));

vi.mock('./ranking-view', () => ({
  RankingView: (props: {
    readonly state: RankingViewState;
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

describe('RankingScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    captured.props = null;
    api.getRanking.mockReset().mockResolvedValue(staffPage);
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
      20,
      expect.any(AbortSignal),
    );
    expect(onNextCycleAt).toHaveBeenCalledWith('2026-08-21T00:00:00.000Z');

    await act(async () => root.unmount());
    expect(onNextCycleAt).toHaveBeenLastCalledWith(null);
    root = createRoot(container);
  });

  it('CSV 는 첫 응답의 total 만큼 pageSize=100으로 각 페이지를 한 번씩 가져온다', async () => {
    const pageTwo = {
      ...staffPage,
      page: 2,
      items: [{ ...staffPage.items[0], rank: 2 }],
    };
    api.getRanking
      .mockReset()
      .mockResolvedValueOnce(staffPage)
      .mockResolvedValueOnce({ ...staffPage, pageSize: 100, total: 101 })
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
