import { useQuery } from '@tanstack/react-query';
import { requirementsKey, programFeatureKey } from '@/lib/query-keys';
import {
  getSubmissionChecklist,
  getSubmissionForm,
  getSubmissionMatrix,
  listRequirementCurrentFiles,
} from './api';
import type { MatrixQueryInput } from './matrix';

export function useSubmissionMatrixQuery(
  programId: string,
  input: MatrixQueryInput,
) {
  return useQuery({
    queryKey: programFeatureKey(programId, 'submissions', 'matrix', input),
    queryFn: () => getSubmissionMatrix(programId, input),
  });
}

export function useSubmissionChecklistQuery(programId: string) {
  return useQuery({
    queryKey: programFeatureKey(programId, 'submissions', 'checklist'),
    queryFn: () => getSubmissionChecklist(programId),
  });
}

export function useSubmissionFormQuery(programId: string, milestoneId: string) {
  return useQuery({
    queryKey: programFeatureKey(programId, 'submissions', 'form', milestoneId),
    queryFn: () => getSubmissionForm(programId, milestoneId),
  });
}

export function useRequirementCurrentFilesQuery(
  programId: string,
  milestoneId: string,
) {
  return useQuery({
    queryKey: [...requirementsKey(programId, milestoneId), 'current-files'],
    queryFn: () => listRequirementCurrentFiles(milestoneId),
    select: (documents) =>
      documents.filter(
        (document) => document.viewerSubmission?.hasCurrentFile === true,
      ),
  });
}
