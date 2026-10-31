'use client';

import { ProgramCountdown } from '@/components';
import {
  useOptionalRankingCycleReported,
  useOptionalRankingNextCycleAt,
} from './ranking-cycle-context';
import { SidebarBottomSkeleton } from './sidebar-shell';

export function RankingCycleCountdown() {
  const nextCycleAt = useOptionalRankingNextCycleAt();
  const reported = useOptionalRankingCycleReported();
  if (!reported) return <SidebarBottomSkeleton />;
  if (nextCycleAt === null) return null;
  return (
    <ProgramCountdown
      nextMilestoneLabel="다음 수집"
      dueAt={nextCycleAt}
      untilLabel="다음 수집까지"
    />
  );
}
