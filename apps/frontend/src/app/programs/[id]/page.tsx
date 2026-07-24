import { ProgramDetailPage } from '@/features/programs/program-detail-page';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

export default async function ProgramPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return <ProgramDetailPage programId={decodeRouteProgramId(id)} />;
}
