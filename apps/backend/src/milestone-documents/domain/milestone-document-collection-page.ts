import type { MilestoneDocumentCollectionQuery } from './milestone-document-collection-query';

export interface MilestoneDocumentCollectionDocumentRule {
  readonly id: string;
  readonly required: boolean;
}

export interface MilestoneDocumentCollectionApplicationRule {
  readonly applicationId: string;
}

export interface MilestoneDocumentCollectionSubmissionRule {
  readonly applicationId: string;
  readonly milestoneDocumentId: string;
}

export interface MilestoneDocumentCollectionPageRow<
  TApplication extends MilestoneDocumentCollectionApplicationRule,
  TSubmission extends MilestoneDocumentCollectionSubmissionRule,
> {
  readonly application: TApplication;
  readonly cells: readonly (TSubmission | null)[];
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

export interface MilestoneDocumentCollectionPage<
  TApplication extends MilestoneDocumentCollectionApplicationRule,
  TSubmission extends MilestoneDocumentCollectionSubmissionRule,
> {
  readonly rows: readonly MilestoneDocumentCollectionPageRow<
    TApplication,
    TSubmission
  >[];
  readonly page: number;
  readonly pageSize: number;

  readonly total: number;
  readonly filterCounts: MilestoneDocumentCollectionFilterCounts;
  readonly documentTotals: readonly MilestoneDocumentCollectionDocumentTotal[];
}

export function buildMilestoneDocumentCollectionPage<
  TDocument extends MilestoneDocumentCollectionDocumentRule,
  TApplication extends MilestoneDocumentCollectionApplicationRule,
  TSubmission extends MilestoneDocumentCollectionSubmissionRule,
>(
  documents: readonly TDocument[],
  applications: readonly TApplication[],
  submissions: readonly TSubmission[],
  query: MilestoneDocumentCollectionQuery,
): MilestoneDocumentCollectionPage<TApplication, TSubmission> {
  const cellIndex = new Map<string, TSubmission>();
  for (const submission of submissions) {
    cellIndex.set(
      cellKey(submission.applicationId, submission.milestoneDocumentId),
      submission,
    );
  }

  const allRows: readonly MilestoneDocumentCollectionPageRow<
    TApplication,
    TSubmission
  >[] = applications.map((application) => ({
    application,
    cells: documents.map(
      (document) =>
        cellIndex.get(cellKey(application.applicationId, document.id)) ?? null,
    ),
  }));

  const documentTotals = documents.map((document, index) => ({
    documentId: document.id,
    submitted: allRows.filter((row) => isSubmittedAt(row, index)).length,
    total: allRows.length,
  }));
  const filterCounts = {
    all: allRows.length,
    hasMissing: allRows.filter((row) => hasMissingRequired(row, documents))
      .length,
    zeroSubmission: allRows.filter((row) => hasZeroSubmission(row, documents))
      .length,
  };

  const filtered = allRows.filter((row) =>
    matchesFilter(row, documents, query.filter),
  );
  const offset = (query.page - 1) * query.pageSize;
  return {
    rows: filtered.slice(offset, offset + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
    filterCounts,
    documentTotals,
  };
}

function cellKey(applicationId: string, documentId: string): string {
  return `${applicationId}::${documentId}`;
}

function isSubmittedAt(
  row: MilestoneDocumentCollectionPageRow<
    MilestoneDocumentCollectionApplicationRule,
    MilestoneDocumentCollectionSubmissionRule
  >,
  index: number,
): boolean {
  return (row.cells[index] ?? null) !== null;
}

function hasMissingRequired(
  row: MilestoneDocumentCollectionPageRow<
    MilestoneDocumentCollectionApplicationRule,
    MilestoneDocumentCollectionSubmissionRule
  >,
  documents: readonly MilestoneDocumentCollectionDocumentRule[],
): boolean {
  return documents.some(
    (document, index) => document.required && !isSubmittedAt(row, index),
  );
}

function hasZeroSubmission(
  row: MilestoneDocumentCollectionPageRow<
    MilestoneDocumentCollectionApplicationRule,
    MilestoneDocumentCollectionSubmissionRule
  >,
  documents: readonly MilestoneDocumentCollectionDocumentRule[],
): boolean {
  return documents.length > 0 && row.cells.every((cell) => cell === null);
}

function matchesFilter(
  row: MilestoneDocumentCollectionPageRow<
    MilestoneDocumentCollectionApplicationRule,
    MilestoneDocumentCollectionSubmissionRule
  >,
  documents: readonly MilestoneDocumentCollectionDocumentRule[],
  filter: MilestoneDocumentCollectionQuery['filter'],
): boolean {
  switch (filter) {
    case 'HAS_MISSING':
      return hasMissingRequired(row, documents);
    case 'ZERO_SUBMISSION':
      return hasZeroSubmission(row, documents);
    case 'ALL':
      return true;
  }
}
