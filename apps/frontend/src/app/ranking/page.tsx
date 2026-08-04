import { Suspense } from 'react';
import { RankingScreen } from '@/features/ranking';

export default function RankingPage() {
  return (
    <Suspense fallback={null}>
      <RankingScreen />
    </Suspense>
  );
}
