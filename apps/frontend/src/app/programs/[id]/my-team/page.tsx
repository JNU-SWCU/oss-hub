import { redirect } from 'next/navigation';
import {
  decodeRouteProgramId,
  programHref,
} from '@/features/programs/program-paths';

export default async function ProgramMyTeamRedirectPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  redirect(programHref(decodeRouteProgramId(id), '/team'));
}
