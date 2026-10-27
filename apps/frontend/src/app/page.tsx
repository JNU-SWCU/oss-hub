import { loadLandingData } from '@/features/landing/server/load-landing-data';
import { LandingPage } from './landing-page';
import { CosmosPoster } from '@/features/landing/components/cosmos-poster';

export default async function HomePage() {
  const data = await loadLandingData();
  return (
    <LandingPage
      {...data}
      poster={<CosmosPoster programs={data.starPrograms} />}
    />
  );
}
