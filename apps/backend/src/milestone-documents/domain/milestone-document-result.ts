import type {
  ReviewDecision,
  SubmissionStatus,
  MilestoneDocumentSubmissionHistoryEvent,
} from '@prisma/client';
import type { MilestoneDocumentCollectionPage } from './milestone-document-collection-page';
import type { MilestoneDocumentDeliveryPage } from './milestone-document-delivery-page';
import type { MilestoneDocumentSubmittedContent } from './milestone-document-content';
import type {
  MilestoneContext,
  MilestoneDocumentRecord,
  MilestoneDocumentCollectionApplication,
  MilestoneDocumentCollectionSubmission,
} from './milestone-document-record';

export interface MilestoneDocumentViewerSubmissionResult {
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
