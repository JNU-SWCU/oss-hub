import { useQuery } from '@tanstack/react-query';
import { programFeatureKey } from '@/lib/query-keys';
import { getSubmissionMatrix } from './api';
import type { MatrixQueryInput } from './matrix';

export function useSubmissionMatrixQuery(
  programId: string,
  input: MatrixQueryInput,
  reloadKey: number,
) {
  return useQuery({
    queryKey: programFeatureKey(
      programId,
      'submissions',
      'matrix',
      input,
      reloadKey,
    ),
    queryFn: () => getSubmissionMatrix(programId, input),
  });
}
