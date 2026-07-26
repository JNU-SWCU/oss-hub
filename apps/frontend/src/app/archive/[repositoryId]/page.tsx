import { ArchiveDetailView } from '@/features/archive';

type ArchiveDetailPageProps = {
  readonly params: Promise<{ readonly repositoryId: string }>;
};

export default async function ArchiveDetailPage({
  params,
}: ArchiveDetailPageProps) {
  const { repositoryId } = await params;
  return <ArchiveDetailView repositoryId={repositoryId} />;
}
