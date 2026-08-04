'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getRanking } from '../api';
import { parseRankingYearSearchParam } from '../types';
import { RankingView, type RankingViewState } from './ranking-view';

const PAGE_SIZE = 20;

export function RankingScreen() {
  const searchParams = useSearchParams();
  const year = useMemo(
    () => parseRankingYearSearchParam(searchParams.get('year')),
    [searchParams],
  );
  const [page, setPage] = useState(1);
  const [state, setState] = useState<RankingViewState>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [year]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    void getRanking(year, page, PAGE_SIZE, controller.signal)
      .then((ranking) => setState({ kind: 'ready', ranking }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ kind: 'error' });
        }
      });
    return () => controller.abort();
  }, [page, year, retry]);

  const retryLoad = useCallback(() => setRetry((current) => current + 1), []);

  return (
    <RankingView
      page={page}
      state={state}
      onPageChange={setPage}
      onRetry={retryLoad}
    />
  );
}
