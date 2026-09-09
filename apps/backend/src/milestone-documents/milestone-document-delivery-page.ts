import {
  documentDeliveryStatus,
  type DocumentDeliveryStatus,
} from '../submissions/document-delivery-status';
import {
  buildMilestoneDocumentCollectionPage,
  type MilestoneDocumentCollectionDocumentRule,
  type MilestoneDocumentCollectionApplicationRule,
  type MilestoneDocumentCollectionSubmissionRule,
} from './domain/milestone-document-collection-page';
import type { MilestoneDocumentCollectionQuery } from './domain/milestone-document-collection-query';

export interface MilestoneDocumentDeliveryQuery extends MilestoneDocumentCollectionQuery {
  readonly deliveryStatus?: DocumentDeliveryStatus;
}

export function buildMilestoneDocumentDeliveryPage<
  TDocument extends MilestoneDocumentCollectionDocumentRule,
  TApplication extends MilestoneDocumentCollectionApplicationRule,
  TSubmission extends MilestoneDocumentCollectionSubmissionRule & {
    readonly firstSubmittedAt: Date;
  },
>(
  source: {
    readonly documents: readonly TDocument[];
    readonly applications: readonly TApplication[];
    readonly submissions: readonly TSubmission[];
    readonly dueAt: Date | null;
  },
  query: MilestoneDocumentDeliveryQuery,
) {
  const base = buildMilestoneDocumentCollectionPage(
    source.documents,
    source.applications,
    source.submissions,
    {
      filter: 'ALL',
      page: 1,
      pageSize: Math.max(1, source.applications.length),
    },
  );
  const allRows = base.rows.map((row) => ({
    ...row,
    deliveryStatus: documentDeliveryStatus({
      dueAt: source.dueAt,
      requiredFirstSubmissions: source.documents.flatMap((document, index) =>
        document.required ? [row.cells[index]?.firstSubmittedAt ?? null] : [],
      ),
    }),
  }));
  const deliveryCounts = {
    missing: allRows.filter((row) => row.deliveryStatus === 'MISSING').length,
    late: allRows.filter((row) => row.deliveryStatus === 'LATE').length,
    complete: allRows.filter((row) => row.deliveryStatus === 'COMPLETE').length,
    noRequiredItems: allRows.filter(
      (row) => row.deliveryStatus === 'NO_REQUIRED_ITEMS',
    ).length,
  };
  const filtered = allRows.filter((row) => {
    if (
      query.deliveryStatus !== undefined &&
      row.deliveryStatus !== query.deliveryStatus
    )
      return false;
    switch (query.filter) {
      case 'ALL':
        return true;
      case 'HAS_MISSING':
        return row.deliveryStatus === 'MISSING';
      case 'ZERO_SUBMISSION':
        return (
          source.documents.length > 0 &&
          row.cells.every((cell) => cell === null)
        );
      default: {
        const exhaustive: never = query.filter;
        return exhaustive;
      }
    }
  });
  const offset = (query.page - 1) * query.pageSize;
  return {
    ...base,
    rows: filtered.slice(offset, offset + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
    deliveryCounts,
  };
}
