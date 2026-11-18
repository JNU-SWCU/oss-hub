'use client';

import { ProgramCountdown } from '@/components';
import { useOptionalRankingNextCycleAt } from './ranking-cycle-context';

export function RankingCycleCountdown() {
  const nextCycleAt = useOptionalRankingNextCycleAt();
  if (nextCycleAt === null) return null;
  return (
    <ProgramCountdown
      nextMilestoneLabel="다음 수집"
      dueAt={nextCycleAt}
      untilLabel="다음 수집까지"
    />
  );
}
