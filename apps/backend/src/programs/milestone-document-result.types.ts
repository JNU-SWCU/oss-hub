import type { Readable } from 'node:stream';
import type { MilestoneDocumentArchiveGrouping } from './milestone-document-archive.policy';
import type {
  ReviewDecision,
  SubmissionStatus,
  MilestoneDocumentSubmissionHistoryEvent,
} from '@prisma/client';
import type {
  MilestoneDocumentReviewRecord,
  MilestoneDocumentSubmittedContent,
} from './milestone-document.policy';
import type { MilestoneDocumentCollectionPage } from './milestone-document-collection-page.policy';
import type { MilestoneDocumentDeliveryPage } from './milestone-document-delivery-page.policy';

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

type JsonValue =
  | string
  | number
  | boolean
  | { [key: string]: JsonValue | undefined }
  | JsonValue[]
  | null;

export interface MilestoneDocumentRecord {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  sortOrder: number;
  graceDueAt: Date | null;
  templateFileId: string | null;
  templateFileName: string | null;
}
export interface MilestoneContext {
  readonly id: string;
  readonly programId: string;
  readonly name: string;
  readonly dueAt: Date;
}
export interface MilestoneDocumentCollectionApplication {
  readonly applicationId: string;
  readonly teamName: string;
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
}
export interface MilestoneDocumentCollectionSubmission {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly submittedAt: Date;
  readonly revision: number;
  readonly status: SubmissionStatus;
  readonly file: {
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
  readonly content: JsonValue | null;
  readonly review: MilestoneDocumentReviewRecord | null;
}
export interface CreatedMilestoneDocumentReview {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly resubmissionDueAt: Date | null;
  readonly reviewerNickname: string;
}
interface MilestoneDocumentSubmissionFile {
  readonly id: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}
export interface MilestoneDocumentSubmissionDetail {
  readonly id: string;
  readonly status: SubmissionStatus;
  readonly content: JsonValue | null;
  readonly submittedAt: Date;
  readonly files: readonly MilestoneDocumentSubmissionFile[];
}
export interface UpsertMilestoneDocumentInput {
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
}

interface MilestoneDocumentViewerSubmissionResult {
  readonly submitted: boolean;
  readonly submittedAt: Date | null;
  readonly submittedLate: boolean;
  readonly revision: number | null;
  readonly status: SubmissionStatus | null;
  readonly hasCurrentFile: boolean;
  readonly currentFileName: string | null;
  readonly review: {
    readonly comment: string | null;
    readonly reviewedAt: Date;
    readonly resubmissionDueAt: Date | null;
  } | null;
  readonly history: {
    readonly hasHistory: boolean;
    readonly isComplete: boolean;
  };
}
export interface MilestoneDocumentViewerResult extends MilestoneDocumentRecord {
  readonly viewerSubmission?: MilestoneDocumentViewerSubmissionResult;
  readonly teamSubmissionCount?: {
    readonly submitted: number;
    readonly total: number;
  };
}
export interface MilestoneDocumentCollectionResult extends MilestoneDocumentCollectionPage<
  MilestoneDocumentCollectionApplication,
  MilestoneDocumentCollectionSubmission
> {
  readonly milestone: MilestoneContext;
  readonly documents: readonly MilestoneDocumentRecord[];
}
export interface MilestoneDocumentDeliveryCollectionResult extends MilestoneDocumentDeliveryPage<
  MilestoneDocumentCollectionApplication,
  MilestoneDocumentCollectionSubmission
> {
  readonly milestone: MilestoneContext;
  readonly documents: readonly MilestoneDocumentRecord[];
}
export interface MilestoneDocumentHistoryResult {
  readonly items: readonly {
    readonly event: MilestoneDocumentSubmissionHistoryEvent;
    readonly revision: number | null;
    readonly actorNickname: string;
    readonly comment: string | null;
    readonly createdAt: Date;
    readonly fileName: string | null;
    readonly downloadableFileId: string | null;
    readonly content: MilestoneDocumentSubmittedContent | null;
  }[];
  readonly nextCursor: string | null;
  readonly isComplete: boolean;
}
export interface MilestoneDocumentFeedbackItemResult {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: Date;
  readonly resubmissionDueAt: Date | null;
  readonly applicationId: string;
  readonly programId: string;
  readonly milestoneId: string;
  readonly milestoneName: string;
  readonly itemName: string;
}
export interface MilestoneDocumentFeedbackResult {
  readonly items: readonly MilestoneDocumentFeedbackItemResult[];
}

export interface UploadedMilestoneDocumentFileResponse {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}
