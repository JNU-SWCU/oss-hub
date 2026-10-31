import { PublicProfileView } from '@/features/profile/components/public-profile-view';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

type PublicProfilePageProps = {
  readonly params: Promise<{ readonly userId: string }>;
};

export default async function PublicProfilePage({
  params,
}: PublicProfilePageProps) {
  const { userId } = await params;
  return <PublicProfileView userId={decodeRouteProgramId(userId)} />;
}
