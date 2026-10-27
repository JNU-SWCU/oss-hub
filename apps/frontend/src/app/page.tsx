import { loadLandingData } from '@/features/landing/server/load-landing-data';
import { LandingPage } from './landing-page';

export default async function HomePage() {
  const data = await loadLandingData();
  return <LandingPage {...data} />;
}
