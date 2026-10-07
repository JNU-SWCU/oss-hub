import { redirect } from 'next/navigation';
import { programDocumentsHref } from '@/lib/program-route';

export default async function ProgramSubmissionsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const rawMilestoneId = resolvedSearchParams?.milestoneId;
  const programId = decodeURIComponent(id);
  if (typeof rawMilestoneId === 'string') {
    redirect(programDocumentsHref(programId, rawMilestoneId));
  }
  redirect(programDocumentsHref(programId));
}
