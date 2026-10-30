import {
  documentDeliveryStatus,
  type DocumentDeliveryStatus,
} from './milestone-document.policy';
import {
  buildMilestoneDocumentCollectionPage,
  type MilestoneDocumentCollectionDocumentRule,
  type MilestoneDocumentCollectionApplicationRule,
  type MilestoneDocumentCollectionPage,
  type MilestoneDocumentCollectionSubmissionRule,
} from './milestone-document-collection-page.policy';
import type { MilestoneDocumentCollectionQuery } from './programs.types';

export interface MilestoneDocumentDeliveryQuery extends MilestoneDocumentCollectionQuery {
  readonly deliveryStatus?: DocumentDeliveryStatus;
  readonly document?: {
    readonly id: string;
    readonly submissionState: 'ALL' | 'SUBMITTED' | 'MISSING';
  };
}

export type MilestoneDocumentDeliveryPage<
  TApplication extends MilestoneDocumentCollectionApplicationRule,
  TSubmission extends MilestoneDocumentCollectionSubmissionRule,
> = Omit<MilestoneDocumentCollectionPage<TApplication, TSubmission>, 'rows'> & {
  readonly rows: readonly (MilestoneDocumentCollectionPage<
    TApplication,
    TSubmission
  >['rows'][number] & { readonly deliveryStatus: DocumentDeliveryStatus })[];
  readonly deliveryCounts: {
    readonly missing: number;
    readonly late: number;
    readonly complete: number;
    readonly noRequiredItems: number;
  };
};

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
): MilestoneDocumentDeliveryPage<TApplication, TSubmission> {
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
  const documentIndex = source.documents.findIndex(
    (document) => document.id === query.document?.id,
  );
  const filtered = allRows.filter((row) => {
    if (query.document !== undefined) {
      if (documentIndex < 0) return false;
      const submitted = row.cells[documentIndex] !== null;
      if (query.document.submissionState === 'SUBMITTED' && !submitted)
        return false;
      if (query.document.submissionState === 'MISSING' && submitted)
        return false;
    }
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
