import { apiClient, apiPath } from '@/lib/api-client';
import type {
  MilestoneDocumentHistoryPage,
  MilestoneDocumentCollectionFilter,
  MilestoneDocumentCollectionQueryInput,
  MilestoneDocumentCollection,
  MilestoneDocumentCollectionArchiveGrouping,
} from './milestone-document-collection-dto';

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

function documentsPath(milestoneId: string): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents`;
}

export function buildMilestoneDocumentCollectionSearchParams(
  query: MilestoneDocumentCollectionQueryInput,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('pageSize', String(query.pageSize));
  if (query.document !== undefined) {
    params.set('documentId', query.document.id);
    params.set('submissionState', query.document.submissionState);
  }
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
  if (cursor?.trim()) params.set('cursor', cursor);
  return apiClient<MilestoneDocumentHistoryPage>(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/applications/${encodeURIComponent(applicationId)}/history?${params.toString()}`,
  );
}

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
