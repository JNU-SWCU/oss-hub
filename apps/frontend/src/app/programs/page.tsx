import { redirect } from 'next/navigation';
import { ProgramsScreen } from './programs-screen';

export default async function ProgramsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly status?: string;
  }>;
}) {
  const { status } = await searchParams;
  if (status === 'ended') redirect('/archive');
  return <ProgramsScreen />;
}
