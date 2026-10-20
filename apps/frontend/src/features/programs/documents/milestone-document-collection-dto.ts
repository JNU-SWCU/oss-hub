import type { DocumentDeliveryStatus } from '@/lib/document-delivery';
import type { MilestoneDocumentSubmissionStatus } from './milestone-document-dto';
import type { MilestoneDocumentReviewDecision } from './milestone-document-review-dto';

interface MilestoneDocumentCollectionMilestone {
  readonly id: string;

  readonly programId: string;
  readonly name: string;

  readonly dueAt: string;
}

export interface MilestoneDocumentCollectionDocument {
  readonly id: string;
  readonly name: string;
  readonly isRequired: boolean;
  readonly sortOrder: number;
}

interface MilestoneDocumentCollectionFile {
  readonly name: string;
  readonly sizeBytes: number;
}

interface MilestoneDocumentCollectionReview {
  readonly id: string;
  readonly decision: MilestoneDocumentReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;

  readonly resubmissionDueAt: string | null;
}

type MilestoneDocumentCollectionHistoryEvent =
  'SUBMITTED' | 'RESUBMITTED' | MilestoneDocumentReviewDecision;

export interface MilestoneDocumentCollectionHistory {
  readonly event: MilestoneDocumentCollectionHistoryEvent;

  readonly revision: number | null;
  readonly actorNickname: string;
  readonly comment: string | null;
  readonly createdAt: string;
  readonly fileName: string | null;

  readonly downloadUrl: string | null;
  readonly content?: MilestoneDocumentCollectionContent | null;
}

export interface MilestoneDocumentHistoryPage {
  readonly items: readonly MilestoneDocumentCollectionHistory[];
  readonly nextCursor: string | null;
  readonly isComplete: boolean;
}

export type MilestoneDocumentCollectionContent = {
  readonly type: 'TEXT';
  readonly text: string;
};

export interface MilestoneDocumentCollectionCell {
  readonly documentId: string;
  readonly isSubmitted: boolean;

  readonly status: MilestoneDocumentSubmissionStatus | null;

  readonly revision: number | null;
  readonly submittedAt: string | null;
  readonly file: MilestoneDocumentCollectionFile | null;

  readonly content: MilestoneDocumentCollectionContent | null;
  readonly review: MilestoneDocumentCollectionReview | null;
}

export interface MilestoneDocumentCollectionRow {
  readonly deliveryStatus: DocumentDeliveryStatus;
  readonly applicationId: string;
  readonly teamName: string;

  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
  readonly cells: readonly MilestoneDocumentCollectionCell[];
}

export type MilestoneDocumentCollectionFilter =
  | 'ALL'
  | 'HAS_MISSING'
  | 'ZERO_SUBMISSION'
  | 'LATE'
  | 'COMPLETE'
  | 'NO_REQUIRED_ITEMS';

export interface MilestoneDocumentCollectionSelection {
  readonly id: string;
  readonly submissionState: 'ALL' | 'SUBMITTED' | 'MISSING';
}

export interface MilestoneDocumentCollectionQueryInput {
  readonly document?: MilestoneDocumentCollectionSelection;
  readonly page: number;
  readonly pageSize: number;
  readonly filter: MilestoneDocumentCollectionFilter;
}

export interface MilestoneDocumentCollectionFilterCounts {
  readonly all: number;
  readonly hasMissing: number;
  readonly zeroSubmission: number;
}

export interface MilestoneDocumentCollectionDocumentTotal {
  readonly documentId: string;
  readonly submitted: number;
  readonly total: number;
}

export interface MilestoneDocumentCollection {
  readonly deliveryCounts: MilestoneDocumentDeliveryCounts;
  readonly milestone: MilestoneDocumentCollectionMilestone;
  readonly documents: readonly MilestoneDocumentCollectionDocument[];

  readonly rows: readonly MilestoneDocumentCollectionRow[];
  readonly page: number;
  readonly pageSize: number;

  readonly total: number;
  readonly filterCounts: MilestoneDocumentCollectionFilterCounts;
  readonly documentTotals: readonly MilestoneDocumentCollectionDocumentTotal[];
}

export interface MilestoneDocumentDeliveryCounts {
  readonly missing: number;
  readonly late: number;
  readonly complete: number;
  readonly noRequiredItems: number;
}

export type MilestoneDocumentCollectionArchiveGrouping = 'TEAM' | 'DOCUMENT';
