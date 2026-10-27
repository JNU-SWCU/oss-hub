import { permanentRedirect } from 'next/navigation';

type ArchiveDetailPageProps = {
  readonly params: Promise<{ readonly repositoryId: string }>;
};

export default async function ArchiveDetailPage({
  params,
}: ArchiveDetailPageProps) {
  const { repositoryId } = await params;
  permanentRedirect(`/projects/${encodeURIComponent(repositoryId)}`);
}
