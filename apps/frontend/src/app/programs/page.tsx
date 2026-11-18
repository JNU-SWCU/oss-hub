import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query';
import { cookies } from 'next/headers';
import {
  parseProgramListSearchParams,
  programListInput,
  programListKey,
  programListPath,
} from '@/features/programs/catalog/program-list-request';
import { parsePublicProgramList } from '@/features/programs/catalog/public-program-list';
import { serverApiClient } from '@/lib/server-api-client';
import { ProgramsClient } from './programs-client';

export default async function ProgramsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const jar = await cookies();
  if (jar.has('__Host-oss_session') || jar.has('oss_session_dev')) {
    return <ProgramsClient />;
  }

  const params = await searchParams;
  const input = programListInput(
    parseProgramListSearchParams({
      get(name) {
        const value = params[name];
        return (Array.isArray(value) ? value[0] : value) ?? null;
      },
    }),
  );
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: programListKey(input, 'public'),
    queryFn: async () =>
      parsePublicProgramList(await serverApiClient(programListPath(input))),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProgramsClient publicSnapshotTime={Date.now()} />
    </HydrationBoundary>
  );
}
