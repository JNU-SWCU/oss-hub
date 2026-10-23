import { apiClient } from '@/lib/api-client';
import type {
  ProgramDocumentChangeRequestScope,
  ProgramDocumentChangeRequestTargets,
  ProgramDocumentChangeRequestInput,
} from './program-document-change-request-dto';

export function changeRequestTargetCount(
  targets: ProgramDocumentChangeRequestTargets,
  includeFinalDecisions: boolean,
): number {
  const open = targets.submitted + targets.changesRequested;
  return includeFinalDecisions
    ? open + targets.approved + targets.rejected
    : open;
}

function changeRequestsPath(programId: string): string {
  return `programs/${encodeURIComponent(programId)}/documents/change-requests`;
}

function scopeFields(
  scope: ProgramDocumentChangeRequestScope,
): Record<string, string> {
  return scope.kind === 'TEAM'
    ? { scope: 'TEAM', teamId: scope.teamId }
    : { scope: 'PROGRAM' };
}

export function getProgramDocumentChangeRequestTargets(
  programId: string,
  scope: ProgramDocumentChangeRequestScope,
): Promise<ProgramDocumentChangeRequestTargets> {
  const search = new URLSearchParams(scopeFields(scope));
  return apiClient<ProgramDocumentChangeRequestTargets>(
    `${changeRequestsPath(programId)}/targets?${search.toString()}`,
  );
}

export function createProgramDocumentChangeRequest(
  programId: string,
  input: ProgramDocumentChangeRequestInput,
): Promise<{ readonly requestedCount: number }> {
  return apiClient<{ readonly requestedCount: number }>(
    changeRequestsPath(programId),
    {
      method: 'POST',
      body: JSON.stringify({
        ...scopeFields(input.scope),
        includeFinalDecisions: input.includeFinalDecisions,
        comment: input.comment,
        resubmissionDueAt: input.resubmissionDueAt,
        expectedVersion: input.expectedVersion,
      }),
    },
  );
}
