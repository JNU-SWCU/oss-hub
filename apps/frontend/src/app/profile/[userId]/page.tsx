import { PublicProfileView } from '@/features/profile/components/public-profile-view';

type PublicProfilePageProps = {
  readonly params: Promise<{ readonly userId: string }>;
};

export default async function PublicProfilePage({
  params,
}: PublicProfilePageProps) {
  const { userId } = await params;
  return <PublicProfileView userId={userId} />;
}
