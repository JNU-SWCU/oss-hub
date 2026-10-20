import { apiFileClient, type ApiFileDownload } from '@/lib/api-client';
import type {
  ProgramDocumentArchiveScope,
  ProgramDocumentArchiveGrouping,
} from './program-document-archive-dto';

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
