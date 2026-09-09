import type { MilestoneDocumentArchiveDocument } from './domain/milestone-document-archive';
import type { ArchiveProgram } from './milestone-document-archive.repository';
import { milestoneDocumentArchiveFolderName } from './milestone-document-download-file-name';

/** Same-name documents from different stages stay identifiable in paths and CSV headers. */
export function archiveDocumentsWithStageNames(
  milestones: ArchiveProgram['milestones'],
  isSingleMilestone: boolean,
): readonly MilestoneDocumentArchiveDocument[] {
  return milestones.flatMap((milestone) =>
    milestone.documents.map((document) => ({
      ...document,
      name: isSingleMilestone
        ? document.name
        : `${milestone.name} - ${document.name}`,
    })),
  );
}

/** Use the milestone deadline in Seoul, not the changing download date. */
export function archiveFileName(name: string, dueAt: Date): string {
  const due = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dueAt);
  return `${milestoneDocumentArchiveFolderName(name)}_${due}.zip`;
}
