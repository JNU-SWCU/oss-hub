import { ProjectDetailView } from '@/features/projects';

export default async function ProjectDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectDetailView projectId={projectId} />;
}
