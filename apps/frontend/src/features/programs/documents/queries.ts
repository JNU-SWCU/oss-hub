import { useQuery } from '@tanstack/react-query';
import { programFeatureKey } from '@/lib/query-keys';
import { getMilestoneDocumentCollection } from './milestone-document-collection-api';
import type { MilestoneDocumentCollectionQueryInput } from './milestone-document-collection-dto';

export function useMilestoneDocumentCollectionQuery(
  programId: string,
  milestoneId: string,
  input: MilestoneDocumentCollectionQueryInput,
) {
  return useQuery({
    queryKey: programFeatureKey(
      programId,
      'documents',
      'collection',
      milestoneId,
      input,
    ),
    queryFn: () => getMilestoneDocumentCollection(milestoneId, input),
  });
}
