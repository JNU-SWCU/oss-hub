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
  const [isExportingCsv, setIsExportingCsv] = useState(false);

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
    if (isExportingCsv) return;
    setIsExportingCsv(true);
    void getRanking(year, 1, RANKING_CSV_PAGE_SIZE)
      .then((ranking) => {
        if (ranking.viewerClass !== RANKING_VIEWER_CLASSES.STAFF) {
          throw new Error('CSV export requires a staff ranking envelope');
        }
        downloadTextFile(
          rankingCsvFilename(ranking.year),
          buildRankingCsv(ranking.items),
        );
      })
      .finally(() => {
        setIsExportingCsv(false);
      });
  }, [isExportingCsv, year]);

  return (
    <RankingView
      page={page}
      state={state}
      onPageChange={setPage}
      onRetry={retryLoad}
      onExportCsv={exportCsv}
      isExportingCsv={isExportingCsv}
    />
  );
}
