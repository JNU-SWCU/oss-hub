import type { Readable } from 'node:stream';
import type { MilestoneDocumentArchiveGrouping } from './domain/milestone-document-archive';

export type MilestoneDocumentArchiveScope =
  | {
      readonly kind: 'ALL';
      readonly grouping: MilestoneDocumentArchiveGrouping;
    }
  | { readonly kind: 'DOCUMENT'; readonly documentId: string };

export type ProgramDocumentArchiveScope = (
  | { readonly kind: 'PROGRAM' }
  | { readonly kind: 'MILESTONE'; readonly milestoneId: string }
  | { readonly kind: 'TEAM'; readonly teamId: string }
) & { readonly grouping?: MilestoneDocumentArchiveGrouping };

export interface MilestoneDocumentArchive {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: 'application/zip';

  readonly contentLength: number | null;
}
