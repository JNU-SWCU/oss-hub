import { permanentRedirect } from 'next/navigation';
import {
  buildProgramListHref,
  parseProgramListYear,
} from '@/features/programs/catalog/program-list-sort';

export default async function ArchivePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly year?: string }>;
}) {
  const { year } = await searchParams;
  permanentRedirect(
    buildProgramListHref({
      status: 'ended',
      year: parseProgramListYear(year ?? null),
    }),
  );
}
