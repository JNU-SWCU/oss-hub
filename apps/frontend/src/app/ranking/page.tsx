'use client';

import { Suspense } from 'react';
import { RankingScreen } from '@/features/ranking';
import { useRankingCycle } from '../_shell/ranking-cycle-context';

/**
 * Public ranking — no gate. Columns and CSV follow viewerClass on GET /ranking.
 * Session role is not consulted. nextCycleAt is published from the page fetch.
 */
export default function RankingPage() {
  const { setNextCycleAt } = useRankingCycle();

  return (
    <Suspense fallback={null}>
      <RankingScreen onNextCycleAt={setNextCycleAt} />
    </Suspense>
  );
}
