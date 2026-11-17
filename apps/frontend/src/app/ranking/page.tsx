import { RankingPageHeader } from '@/features/ranking';
import { RankingRoute } from './ranking-route';

export default function RankingPage() {
  return <RankingRoute header={<RankingPageHeader />} />;
}
