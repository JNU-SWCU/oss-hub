import { useQuery } from '@tanstack/react-query';
import { featureKey, programFeatureKey } from '@/lib/query-keys';
import { getEditableProgram } from './api';
import { getAuthoringUploadPolicy } from './program-authoring-api';

export function useAuthoringUploadPolicyQuery() {
  return useQuery({
    queryKey: featureKey('program-authoring', 'upload-policy'),
    queryFn: getAuthoringUploadPolicy,
  });
}

export function useEditableProgramQuery(programId: string) {
  return useQuery({
    queryKey: programFeatureKey(programId, 'edit'),
    queryFn: () => getEditableProgram(programId),
  });
}
