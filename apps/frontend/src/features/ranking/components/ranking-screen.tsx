'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getRanking } from '../api';
import {
  buildRankingCsv,
  downloadTextFile,
  RANKING_CSV_PAGE_SIZE,
  rankingCsvFilename,
} from '../csv';
import { RANKING_VIEWER_CLASSES, parseRankingYearSearchParam } from '../types';
import { RankingView, type RankingViewState } from './ranking-view';

const PAGE_SIZE = 20;

interface RankingScreenProps {
  /** Publishes the page-fetch envelope's nextCycleAt to the product shell. */
  readonly onNextCycleAt: (nextCycleAt: string | null) => void;
}

export function RankingScreen({ onNextCycleAt }: RankingScreenProps) {
  const searchParams = useSearchParams();
  const year = useMemo(
    () => parseRankingYearSearchParam(searchParams.get('year')),
    [searchParams],
  );
  const [page, setPage] = useState(1);
  const [state, setState] = useState<RankingViewState>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const [exportStatus, setExportStatus] = useState<
    'idle' | 'preparing' | 'error'
  >('idle');

  useEffect(() => {
    setPage(1);
  }, [year]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    void getRanking(year, page, PAGE_SIZE, controller.signal)
      .then((ranking) => {
        setState({ kind: 'ready', ranking });
        onNextCycleAt(ranking.nextCycleAt);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ kind: 'error' });
          onNextCycleAt(null);
        }
      });
    return () => {
      controller.abort();
      onNextCycleAt(null);
    };
  }, [page, year, retry, onNextCycleAt]);

  const retryLoad = useCallback(() => setRetry((current) => current + 1), []);

  const exportCsv = useCallback(() => {
    if (exportStatus === 'preparing') return;
    setExportStatus('preparing');
    void getRanking(year, 1, RANKING_CSV_PAGE_SIZE)
      .then(async (firstPage) => {
        if (firstPage.viewerClass !== RANKING_VIEWER_CLASSES.STAFF) {
          throw new Error('CSV export requires a staff ranking envelope');
        }
        const pageCount = Math.max(
          1,
          Math.ceil(firstPage.total / firstPage.pageSize),
        );
        const pages = await Promise.all(
          Array.from({ length: pageCount - 1 }, (_, index) =>
            getRanking(year, index + 2, RANKING_CSV_PAGE_SIZE),
          ),
        );
        const allPages = [firstPage, ...pages];
        if (allPages.some((page, index) => page.page !== index + 1)) {
          throw new Error('CSV export page sequence is invalid');
        }
        if (
          allPages.some(
            (page) => page.viewerClass !== RANKING_VIEWER_CLASSES.STAFF,
          )
        ) {
          throw new Error('CSV export viewer class changed');
        }
        downloadTextFile(
          rankingCsvFilename(firstPage.year),
          buildRankingCsv(allPages.flatMap((page) => page.items)),
        );
        setExportStatus('idle');
      })
      .catch(() => setExportStatus('error'));
  }, [exportStatus, year]);

  return (
    <RankingView
      page={page}
      state={state}
      onPageChange={setPage}
      onRetry={retryLoad}
      onExportCsv={exportCsv}
      isExportingCsv={exportStatus === 'preparing'}
      exportStatus={exportStatus}
    />
  );
}
