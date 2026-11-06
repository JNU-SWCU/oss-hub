import { apiClient, apiPath } from '@/lib/api-client';
import type {
  RequirementHistoryPage,
  RequirementCollectionFilter,
  RequirementCollectionQueryInput,
  RequirementCollection,
  RequirementCollectionArchiveGrouping,
} from './requirement-collection-dto';

export const REQUIREMENT_COLLECTION_FILTERS: readonly RequirementCollectionFilter[] =
  [
    'ALL',
    'HAS_MISSING',
    'LATE',
    'COMPLETE',
    'NO_REQUIRED_ITEMS',
    'ZERO_SUBMISSION',
  ];

export const REQUIREMENT_COLLECTION_PAGE_SIZE = 20;

function documentsPath(milestoneId: string): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents`;
}

export function buildRequirementCollectionSearchParams(
  query: RequirementCollectionQueryInput,
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

export function getRequirementCollection(
  milestoneId: string,
  query: RequirementCollectionQueryInput,
): Promise<RequirementCollection> {
  const params = buildRequirementCollectionSearchParams(query);
  return apiClient<RequirementCollection>(
    `${documentsPath(milestoneId)}/collection?${params.toString()}`,
  );
}

export function submissionFileHref(
  milestoneId: string,
  documentId: string,
  teamId: string,
): string {
  return apiPath(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/teams/${encodeURIComponent(teamId)}/file`,
  );
}

export function getRequirementHistory(
  milestoneId: string,
  documentId: string,
  teamId: string,
  cursor: string | null = null,
): Promise<RequirementHistoryPage> {
  const params = new URLSearchParams();
  params.set('limit', '20');
  if (cursor?.trim()) params.set('cursor', cursor);
  return apiClient<RequirementHistoryPage>(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/teams/${encodeURIComponent(teamId)}/history?${params.toString()}`,
  );
}

export function requirementCollectionArchiveHref(
  milestoneId: string,
  grouping: RequirementCollectionArchiveGrouping,
): string {
  const params = new URLSearchParams();
  params.set('groupBy', grouping);
  return apiPath(
    `${documentsPath(milestoneId)}/collection/archive?${params.toString()}`,
  );
}

export function requirementCollectionDocumentArchiveHref(
  milestoneId: string,
  documentId: string,
): string {
  const params = new URLSearchParams();
  params.set('documentId', documentId);
  return apiPath(
    `${documentsPath(milestoneId)}/collection/archive?${params.toString()}`,
  );
}
