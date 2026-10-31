import { ProjectDetailView } from '@/features/projects';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

export default async function ProjectDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectDetailView projectId={decodeRouteProgramId(projectId)} />;
}
