import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { getAuthoringUploadPolicy } from './program-authoring-api';

export function useAuthoringUploadPolicyQuery() {
  return useQuery({
    queryKey: featureKey('program-authoring', 'upload-policy'),
    queryFn: getAuthoringUploadPolicy,
  });
}
