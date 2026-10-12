import { apiClient } from '@/lib/api-client';

export type ProgramDocumentChangeRequestScope =
  | { readonly kind: 'PROGRAM' }
  | { readonly kind: 'TEAM'; readonly teamId: string };

export interface ProgramDocumentChangeRequestTargets {
  readonly submitted: number;
  readonly changesRequested: number;
  readonly approved: number;
  readonly rejected: number;
}

export interface ProgramDocumentChangeRequestInput {
  readonly scope: ProgramDocumentChangeRequestScope;
  readonly includeFinalDecisions: boolean;
  readonly comment: string;
  readonly resubmissionDueAt: string;
  readonly expectedCount: number;
}

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...scopeFields(input.scope),
        includeFinalDecisions: input.includeFinalDecisions,
        comment: input.comment,
        resubmissionDueAt: input.resubmissionDueAt,
        expectedCount: input.expectedCount,
      }),
    },
  );
}
