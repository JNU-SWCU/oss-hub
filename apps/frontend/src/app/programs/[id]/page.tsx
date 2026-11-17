import { notFound } from 'next/navigation';
import { isProgramMissing } from '@/features/programs/catalog/server/program-presence';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramDetailScreen } from './program-detail-screen';

export default async function ProgramPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  const programId = decodeRouteProgramId(id);
  if (await isProgramMissing(programId)) notFound();
  return <ProgramDetailScreen programId={programId} />;
}
