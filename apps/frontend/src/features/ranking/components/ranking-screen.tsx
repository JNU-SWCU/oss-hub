'use client';

import { useCallback, useEffect, useState } from 'react';
import { getRanking } from '../api';
import { RANKING_PERIODS, type RankingPeriod } from '../types';
import { RankingView, type RankingViewState } from './ranking-view';

const PAGE_SIZE = 20;

export function RankingScreen() {
  const [period, setPeriod] = useState<RankingPeriod>(
    RANKING_PERIODS.THIS_YEAR,
  );
  const [page, setPage] = useState(1);
  const [state, setState] = useState<RankingViewState>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    void getRanking(period, page, PAGE_SIZE, controller.signal)
      .then((ranking) => setState({ kind: 'ready', ranking }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ kind: 'error' });
        }
      });
    return () => controller.abort();
  }, [page, period, retry]);

  const changePeriod = useCallback((nextPeriod: RankingPeriod) => {
    setPeriod(nextPeriod);
    setPage(1);
  }, []);

  const retryLoad = useCallback(() => setRetry((current) => current + 1), []);

  return (
    <RankingView
      period={period}
      page={page}
      state={state}
      onPeriodChange={changePeriod}
      onPageChange={setPage}
      onRetry={retryLoad}
    />
  );
}
