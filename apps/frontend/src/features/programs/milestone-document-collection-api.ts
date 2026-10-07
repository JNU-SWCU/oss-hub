import type { DocumentDeliveryStatus } from '@/lib/document-delivery';
import { apiClient, apiPath } from '@/lib/api-client';
import type { MilestoneDocumentSubmissionStatus } from './milestone-document-api';
import type { MilestoneDocumentReviewDecision } from './milestone-document-review-api';

export interface MilestoneDocumentCollectionMilestone {
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

export interface MilestoneDocumentCollectionFile {
  readonly name: string;
  readonly sizeBytes: number;
}

export interface MilestoneDocumentCollectionReview {
  readonly id: string;
  readonly decision: MilestoneDocumentReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;

  readonly resubmissionDueAt: string | null;
}

export type MilestoneDocumentCollectionHistoryEvent =
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

export const MILESTONE_DOCUMENT_COLLECTION_FILTERS: readonly MilestoneDocumentCollectionFilter[] =
  [
    'ALL',
    'HAS_MISSING',
    'LATE',
    'COMPLETE',
    'NO_REQUIRED_ITEMS',
    'ZERO_SUBMISSION',
  ];

export const MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE = 20;

export interface MilestoneDocumentCollectionQueryInput {
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

function documentsPath(milestoneId: string): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents`;
}

export function buildMilestoneDocumentCollectionSearchParams(
  query: MilestoneDocumentCollectionQueryInput,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('pageSize', String(query.pageSize));
  switch (query.filter) {
    case 'LATE':
    case 'COMPLETE':
    case 'NO_REQUIRED_ITEMS':
      params.set('filter', 'ALL');
      params.set('deliveryStatus', query.filter);
      break;
    case 'ALL':
    case 'HAS_MISSING':
    case 'ZERO_SUBMISSION':
      params.set('filter', query.filter);
      break;
    default: {
      const exhaustive: never = query.filter;
      return exhaustive;
    }
  }
  return params;
}

export function getMilestoneDocumentCollection(
  milestoneId: string,
  query: MilestoneDocumentCollectionQueryInput,
): Promise<MilestoneDocumentCollection> {
  const params = buildMilestoneDocumentCollectionSearchParams(query);
  return apiClient<MilestoneDocumentCollection>(
    `${documentsPath(milestoneId)}/collection?${params.toString()}`,
  );
}

export function milestoneDocumentSubmissionFileHref(
  milestoneId: string,
  documentId: string,
  applicationId: string,
): string {
  return apiPath(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/applications/${encodeURIComponent(applicationId)}/file`,
  );
}

export function getMilestoneDocumentHistory(
  milestoneId: string,
  documentId: string,
  applicationId: string,
  cursor: string | null = null,
): Promise<MilestoneDocumentHistoryPage> {
  const params = new URLSearchParams();
  params.set('limit', '20');
  if (cursor !== null) params.set('cursor', cursor);
  return apiClient<MilestoneDocumentHistoryPage>(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/applications/${encodeURIComponent(applicationId)}/history?${params.toString()}`,
  );
}

export type MilestoneDocumentCollectionArchiveGrouping = 'TEAM' | 'DOCUMENT';

export function milestoneDocumentCollectionArchiveHref(
  milestoneId: string,
  grouping: MilestoneDocumentCollectionArchiveGrouping,
): string {
  const params = new URLSearchParams();
  params.set('groupBy', grouping);
  return apiPath(
    `${documentsPath(milestoneId)}/collection/archive?${params.toString()}`,
  );
}

export function milestoneDocumentCollectionDocumentArchiveHref(
  milestoneId: string,
  documentId: string,
): string {
  const params = new URLSearchParams();
  params.set('documentId', documentId);
  return apiPath(
    `${documentsPath(milestoneId)}/collection/archive?${params.toString()}`,
  );
}
