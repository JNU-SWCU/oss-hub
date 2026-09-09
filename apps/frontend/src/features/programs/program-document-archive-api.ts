import { apiFileClient, type ApiFileDownload } from '@/lib/api-client';

export type ProgramDocumentArchiveScope =
  | { readonly kind: 'PROGRAM' }
  | { readonly kind: 'MILESTONE'; readonly milestoneId: string }
  | { readonly kind: 'TEAM'; readonly teamId: string };
export type ProgramDocumentArchiveGrouping = 'TEAM' | 'DOCUMENT';

export function programDocumentArchivePath(
  programId: string,
  scope: ProgramDocumentArchiveScope,
  grouping: ProgramDocumentArchiveGrouping,
): string {
  const query = new URLSearchParams({ scope: scope.kind, groupBy: grouping });
  if (scope.kind === 'MILESTONE') query.set('milestoneId', scope.milestoneId);
  if (scope.kind === 'TEAM') query.set('teamId', scope.teamId);
  return `programs/${encodeURIComponent(programId)}/documents/collection/archive?${query}`;
}

export function downloadProgramDocumentArchive(
  programId: string,
  scope: ProgramDocumentArchiveScope,
  grouping: ProgramDocumentArchiveGrouping,
): Promise<ApiFileDownload> {
  return apiFileClient(programDocumentArchivePath(programId, scope, grouping));
}
