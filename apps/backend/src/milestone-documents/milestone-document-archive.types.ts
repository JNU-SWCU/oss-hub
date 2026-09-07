import type { Readable } from 'node:stream';
import type { MilestoneDocumentArchiveGrouping } from './domain/milestone-document-archive';

/** ALL groups every team's current documents; DOCUMENT is one document type without folders. */
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
  /** Exact length lets a browser reject a ZIP truncated after successful headers. */
  readonly contentLength: number | null;
}
