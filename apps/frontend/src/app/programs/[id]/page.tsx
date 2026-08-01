import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramDetailScreen } from './program-detail-screen';

export default async function ProgramPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return <ProgramDetailScreen programId={decodeRouteProgramId(id)} />;
}
