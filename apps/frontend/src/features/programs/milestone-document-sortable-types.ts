import type { MilestoneDocument } from './milestone-document-api';
import type { MilestoneDocumentDropZone } from './milestone-document-pointer';

export interface MilestoneDocumentDragPosition {
  readonly activeId: string;
  readonly overId: string | null;
  readonly pointerId: number | null;
  readonly dropZones: readonly MilestoneDocumentDropZone[];
}

export interface MilestoneDocumentSortableListProps {
  readonly milestoneId: string;
  readonly documents: readonly MilestoneDocument[];
  readonly isBusy: boolean;
  readonly deleteTargetId: string | null;
  readonly rowError: {
    readonly documentId: string;
    readonly message: string;
  } | null;
  readonly onReorder: (
    documentIds: readonly string[],
    activeDocumentId: string,
  ) => Promise<boolean>;
  readonly onEdit: (document: MilestoneDocument) => void;
  readonly onRequestDelete: (document: MilestoneDocument) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onTemplateFile: (document: MilestoneDocument, file: File) => void;
}
