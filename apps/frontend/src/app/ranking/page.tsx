'use client';

import { Suspense } from 'react';
import { RankingScreen } from '@/features/ranking';
import { useRankingCycle } from '../_shell/ranking-cycle-context';

export default function RankingPage() {
  const { setNextCycleAt } = useRankingCycle();

  return (
    <Suspense fallback={null}>
      <RankingScreen onNextCycleAt={setNextCycleAt} />
    </Suspense>
  );
}
