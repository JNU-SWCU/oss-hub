import type {
  ArchiveProgram,
  MilestoneDocumentArchiveDocument,
} from './milestone-document-archive';
import { milestoneDocumentArchiveFolderName } from './milestone-document-download-file-name';

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

export function archiveFileName(name: string, dueAt: Date): string {
  const due = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dueAt);
  return `${milestoneDocumentArchiveFolderName(name)}_${due}.zip`;
}
