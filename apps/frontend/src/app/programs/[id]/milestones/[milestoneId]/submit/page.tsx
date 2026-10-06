import { redirect } from 'next/navigation';
import { programDocumentsHref } from '@/lib/program-route';

export default async function MilestoneSubmitPage({
  params,
}: {
  readonly params: Promise<{
    readonly id: string;
    readonly milestoneId: string;
  }>;
}) {
  const { id, milestoneId } = await params;
  redirect(
    programDocumentsHref(
      decodeURIComponent(id),
      decodeURIComponent(milestoneId),
    ),
  );
}
