'use client';

import type { ReactNode } from 'react';
import { useSession } from '@/features/auth/use-session';
import { RankingScreen } from '@/features/ranking';
import { useRankingCycle } from '../_shell/ranking-cycle-context';
import { RankingCycleCountdown } from '../_shell/ranking-cycle-countdown';
import { SectionFacetChips } from '../_shell/section-facet-chips';

export function RankingRoute({ header }: { readonly header: ReactNode }) {
  const { setNextCycleAt } = useRankingCycle();
  const { user } = useSession();

  return (
    <RankingScreen
      header={header}
      onNextCycleAt={setNextCycleAt}
      viewerGithubLogin={user?.nickname ?? null}
      filters={
        <>
          <SectionFacetChips />
          <div
            data-slot="ranking-page-countdown"
            className="empty:hidden shell:hidden"
          >
            <RankingCycleCountdown />
          </div>
        </>
      }
    />
  );
}
