import { DOCUMENT_DELIVERY_LABELS } from '@/lib/document-delivery';
import type {
  MilestoneDocumentCollection,
  MilestoneDocumentDeliveryCounts,
  MilestoneDocumentCollectionCell,
  MilestoneDocumentCollectionDocumentTotal,
  MilestoneDocumentCollectionFilter,
  MilestoneDocumentCollectionFilterCounts,
  MilestoneDocumentCollectionQueryInput,
  MilestoneDocumentCollectionRow,
} from './milestone-document-collection-api';

export const MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS = {
  ALL: '전체',

  HAS_MISSING: DOCUMENT_DELIVERY_LABELS.MISSING,
  LATE: DOCUMENT_DELIVERY_LABELS.LATE,
  COMPLETE: DOCUMENT_DELIVERY_LABELS.COMPLETE,
  NO_REQUIRED_ITEMS: DOCUMENT_DELIVERY_LABELS.NO_REQUIRED_ITEMS,
  ZERO_SUBMISSION: '한 장도 안 낸 팀',
} as const satisfies Readonly<
  Record<MilestoneDocumentCollectionFilter, string>
>;

export function collectionCellFor(
  row: MilestoneDocumentCollectionRow,
  documentId: string,
): MilestoneDocumentCollectionCell {
  return (
    row.cells.find((cell) => cell.documentId === documentId) ?? {
      documentId,
      isSubmitted: false,

      status: null,

      revision: null,
      submittedAt: null,
      file: null,

      content: null,
      review: null,
    }
  );
}

export function collectionFilterCountFor(
  counts: MilestoneDocumentCollectionFilterCounts,
  filter: MilestoneDocumentCollectionFilter,
  deliveryCounts: MilestoneDocumentDeliveryCounts,
): number {
  switch (filter) {
    case 'HAS_MISSING':
      return deliveryCounts.missing;
    case 'LATE':
      return deliveryCounts.late;
    case 'COMPLETE':
      return deliveryCounts.complete;
    case 'NO_REQUIRED_ITEMS':
      return deliveryCounts.noRequiredItems;
    case 'ZERO_SUBMISSION':
      return counts.zeroSubmission;
    case 'ALL':
      return counts.all;
  }
}

export function collectionDocumentTotalFor(
  totals: readonly MilestoneDocumentCollectionDocumentTotal[],
  documentId: string,
): MilestoneDocumentCollectionDocumentTotal {
  return (
    totals.find((total) => total.documentId === documentId) ?? {
      documentId,
      submitted: 0,
      total: 0,
    }
  );
}

export function milestoneDocumentCollectionTotalPages(
  total: number,
  pageSize: number,
): number {
  if (total <= 0 || pageSize <= 0) return 0;
  return Math.ceil(total / pageSize);
}

export function milestoneDocumentCollectionPageState(input: {
  readonly page: number;

  readonly total: number;
  readonly pageSize: number;
}): {
  readonly totalPages: number;
  readonly lastPage: number;
  readonly outOfRange: boolean;
} {
  const totalPages = milestoneDocumentCollectionTotalPages(
    input.total,
    input.pageSize,
  );
  const lastPage = Math.max(totalPages, 1);
  return {
    totalPages,
    lastPage,

    outOfRange: totalPages > 0 && input.page > totalPages,
  };
}

function isSameMilestoneDocumentCollectionQuery(
  a: MilestoneDocumentCollectionQueryInput,
  b: MilestoneDocumentCollectionQueryInput,
): boolean {
  return (
    a.page === b.page && a.pageSize === b.pageSize && a.filter === b.filter
  );
}

export interface LoadedMilestoneDocumentCollection {
  readonly query: MilestoneDocumentCollectionQueryInput;
  readonly data: MilestoneDocumentCollection;
}

export function milestoneDocumentCollectionDataFor(
  loaded: LoadedMilestoneDocumentCollection | null,
  query: MilestoneDocumentCollectionQueryInput,
): MilestoneDocumentCollection | null {
  if (loaded === null) return null;
  return isSameMilestoneDocumentCollectionQuery(loaded.query, query)
    ? loaded.data
    : null;
}

export type MilestoneDocumentCollectionLoadPhase =
  'idle' | 'skeleton' | 'refreshing';

export function milestoneDocumentCollectionLoadPhase(input: {
  readonly data: MilestoneDocumentCollection | null;
  readonly isLoading: boolean;
}): MilestoneDocumentCollectionLoadPhase {
  if (!input.isLoading) return 'idle';
  return input.data === null ? 'skeleton' : 'refreshing';
}

export function collectionRowMemberSummary(
  row: MilestoneDocumentCollectionRow,
): string | null {
  const lead = row.applicantName ?? row.memberNicknames[0] ?? null;
  if (lead === null) return null;
  const others = Math.max(row.memberNicknames.length - 1, 0);
  return others === 0 ? lead : `${lead} 외 ${others}명`;
}

export type MilestoneDocumentCollectionEmptyKind =
  | 'wrong-program'
  | 'no-documents'
  | 'no-applications'
  | 'no-filter-results'
  | null;

export function isCollectionProgramMismatch(input: {
  readonly programId: string;

  readonly milestoneProgramId: string;
}): boolean {
  return input.programId !== input.milestoneProgramId;
}

export function collectionEmptyKind(input: {
  readonly programId: string;

  readonly milestoneProgramId: string;
  readonly documentCount: number;

  readonly applicationCount: number;

  readonly filteredCount: number;
}): MilestoneDocumentCollectionEmptyKind {
  if (isCollectionProgramMismatch(input)) return 'wrong-program';
  if (input.documentCount === 0) return 'no-documents';
  if (input.applicationCount === 0) return 'no-applications';
  if (input.filteredCount === 0) return 'no-filter-results';
  return null;
}
