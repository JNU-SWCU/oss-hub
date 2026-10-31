'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRankingUrlState } from '../ranking-url-state';
import { useRankingQuery } from '../queries';
import { getRanking } from '../api';
import {
  buildRankingCsv,
  downloadTextFile,
  RANKING_CSV_PAGE_SIZE,
  rankingCsvFilename,
} from '../csv';
import { RANKING_VIEWER_CLASSES } from '../types';
import { RankingView, type RankingViewState } from './ranking-view';

const PAGE_SIZE = 100;

interface RankingScreenProps {
  readonly onNextCycleAt: (nextCycleAt: string | null) => void;

  readonly filters?: ReactNode;
}

export function RankingScreen({ onNextCycleAt, filters }: RankingScreenProps) {
  const {
    state: { year, page },
    navigate,
  } = useRankingUrlState();
  const query = useRankingQuery(year, page, PAGE_SIZE);
  const state: RankingViewState = query.isPending
    ? { kind: 'loading' }
    : query.isError
      ? { kind: 'error' }
      : { kind: 'ready', ranking: query.data };
  const [exportStatus, setExportStatus] = useState<
    'idle' | 'preparing' | 'error'
  >('idle');

  useEffect(() => {
    onNextCycleAt(query.data?.nextCycleAt ?? null);
    return () => onNextCycleAt(null);
  }, [query.data, onNextCycleAt]);

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
        if (firstPage.page !== 1) {
          throw new Error('CSV export page sequence is invalid');
        }
        const staffPages = [firstPage];
        for (const [index, rankingPage] of pages.entries()) {
          if (rankingPage.viewerClass !== RANKING_VIEWER_CLASSES.STAFF) {
            throw new Error('CSV export viewer class changed');
          }
          if (rankingPage.page !== index + 2) {
            throw new Error('CSV export page sequence is invalid');
          }
          staffPages.push(rankingPage);
        }
        const items = staffPages.flatMap((rankingPage) => rankingPage.items);
        if (items.length !== firstPage.total) {
          throw new Error('CSV export item count does not match total');
        }
        downloadTextFile(
          rankingCsvFilename(firstPage.year),
          buildRankingCsv(items),
        );
        setExportStatus('idle');
      })
      .catch(() => setExportStatus('error'));
  }, [exportStatus, year]);

  return (
    <RankingView
      page={page}
      filters={filters}
      state={state}
      onPageChange={(nextPage) => navigate({ page: nextPage })}
      onRetry={() => void query.refetch()}
      onExportCsv={exportCsv}
      isExportingCsv={exportStatus === 'preparing'}
      exportStatus={exportStatus}
    />
  );
}
