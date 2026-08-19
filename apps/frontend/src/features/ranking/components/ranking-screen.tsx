'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getRanking } from '../api';
import { parseRankingYearSearchParam, type RankingViewerRole } from '../types';
import { RankingView, type RankingViewState } from './ranking-view';

const PAGE_SIZE = 20;

interface RankingScreenProps {
  /**
   * app 계층이 `useSessionRole()` 로 읽은 역할. 모르면 `null` 이고, 그때는
   * 공개 열 구성이다 — 서버도 비로그인에게는 실명을 내려주지 않는다.
   */
  readonly viewerRole?: RankingViewerRole | null;
}

export function RankingScreen({ viewerRole = null }: RankingScreenProps = {}) {
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
      viewerRole={viewerRole}
      onPageChange={setPage}
      onRetry={retryLoad}
    />
  );
}
