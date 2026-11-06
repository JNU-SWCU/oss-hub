import type { DocumentDeliveryStatus } from '@/lib/document-delivery';
import type { RequirementSubmissionStatus } from './requirement-dto';
import type { RequirementReviewDecision } from './requirement-review-dto';
interface RequirementCollectionMilestone {
  readonly id: string;
  readonly programId: string;
  readonly name: string;
  readonly dueAt: string;
}
export interface RequirementCollectionDocument {
  readonly id: string;
  readonly name: string;
  readonly isRequired: boolean;
  readonly sortOrder: number;
}
interface RequirementCollectionFile {
  readonly name: string;
  readonly sizeBytes: number;
}
interface RequirementCollectionReview {
  readonly id: string;
  readonly decision: RequirementReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;
}
type RequirementCollectionHistoryEvent =
  'SUBMITTED' | 'RESUBMITTED' | RequirementReviewDecision;
export interface RequirementCollectionHistory {
  readonly event: RequirementCollectionHistoryEvent;
  readonly revision: number | null;
  readonly actorNickname: string;
  readonly comment: string | null;
  readonly createdAt: string;
  readonly fileName: string | null;
  readonly downloadUrl: string | null;
  readonly content?: RequirementCollectionContent | null;
}
export interface RequirementHistoryPage {
  readonly items: readonly RequirementCollectionHistory[];
  readonly nextCursor: string | null;
  readonly isComplete: boolean;
}
export type RequirementCollectionContent = {
  readonly type: 'TEXT';
  readonly text: string;
};
export interface RequirementCollectionCell {
  readonly documentId: string;
  readonly isSubmitted: boolean;
  readonly status: RequirementSubmissionStatus | null;
  readonly revision: number | null;
  readonly submittedAt: string | null;
  readonly file: RequirementCollectionFile | null;
  readonly content: RequirementCollectionContent | null;
  readonly review: RequirementCollectionReview | null;
}
export interface RequirementCollectionRow {
  readonly deliveryStatus: DocumentDeliveryStatus;
  readonly teamId: string;
  readonly teamName: string;
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
  readonly cells: readonly RequirementCollectionCell[];
}
export type RequirementCollectionFilter =
  | 'ALL'
  | 'HAS_MISSING'
  | 'ZERO_SUBMISSION'
  | 'LATE'
  | 'COMPLETE'
  | 'NO_REQUIRED_ITEMS';
export interface RequirementCollectionSelection {
  readonly id: string;
  readonly submissionState: 'ALL' | 'SUBMITTED' | 'MISSING';
}
export interface RequirementCollectionQueryInput {
  readonly document?: RequirementCollectionSelection;
  readonly page: number;
  readonly pageSize: number;
  readonly filter: RequirementCollectionFilter;
}
export interface RequirementCollectionFilterCounts {
  readonly all: number;
  readonly hasMissing: number;
  readonly zeroSubmission: number;
}
export interface RequirementCollectionDocumentTotal {
  readonly documentId: string;
  readonly submitted: number;
  readonly total: number;
}
export interface RequirementCollection {
  readonly deliveryCounts: RequirementDeliveryCounts;
  readonly milestone: RequirementCollectionMilestone;
  readonly documents: readonly RequirementCollectionDocument[];
  readonly rows: readonly RequirementCollectionRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly filterCounts: RequirementCollectionFilterCounts;
  readonly documentTotals: readonly RequirementCollectionDocumentTotal[];
}
export interface RequirementDeliveryCounts {
  readonly missing: number;
  readonly late: number;
  readonly complete: number;
  readonly noRequiredItems: number;
}
export type RequirementCollectionArchiveGrouping = 'TEAM' | 'DOCUMENT';
