import { ProgramDetailPage } from '@/features/programs/program-detail-page';

export default async function ProgramPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return <ProgramDetailPage programId={id} />;
}
