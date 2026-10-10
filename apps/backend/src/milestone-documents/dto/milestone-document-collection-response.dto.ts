import type { ReviewDecision, SubmissionStatus } from '@prisma/client';
import type { DocumentDeliveryStatus } from '../../submissions/domain/document-delivery-status';
import type { MilestoneDocumentCollectionPage } from '../domain/milestone-document-collection-page';
import {
  type MilestoneDocumentSubmittedContent,
  readMilestoneDocumentSubmittedContent,
} from '../domain/milestone-document-content';
import type {
  MilestoneContext,
  MilestoneDocumentCollectionApplication,
  MilestoneDocumentCollectionSubmission,
  MilestoneDocumentRecord,
} from '../domain/milestone-document-record';

export interface MilestoneDocumentCollectionMilestoneResponseDto {
  readonly id: string;

  readonly programId: string;
  readonly name: string;
  readonly dueAt: string;
}

export interface MilestoneDocumentCollectionDocumentResponseDto {
  readonly id: string;
  readonly name: string;
  readonly isRequired: boolean;
  readonly sortOrder: number;
}

export interface MilestoneDocumentCollectionFileResponseDto {
  readonly name: string;
  readonly sizeBytes: number;
}

export interface MilestoneDocumentCollectionCellResponseDto {
  readonly documentId: string;
  readonly isSubmitted: boolean;
  readonly submittedAt: string | null;

  readonly revision: number | null;
  readonly file: MilestoneDocumentCollectionFileResponseDto | null;

  readonly content: MilestoneDocumentSubmittedContent | null;

  readonly status: SubmissionStatus | null;

  readonly review: MilestoneDocumentCollectionReviewResponseDto | null;
}

export interface MilestoneDocumentCollectionReviewResponseDto {
  readonly id: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;

  readonly resubmissionDueAt: string | null;
}

export interface MilestoneDocumentCollectionRowResponseDto {
  readonly applicationId: string;
  readonly teamName: string;
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
  readonly cells: readonly MilestoneDocumentCollectionCellResponseDto[];
}

export interface MilestoneDocumentCollectionFilterCountsResponseDto {
  readonly all: number;
  readonly hasMissing: number;
  readonly zeroSubmission: number;
}

export interface MilestoneDocumentCollectionDocumentTotalResponseDto {
  readonly documentId: string;
  readonly submitted: number;
  readonly total: number;
}

export class MilestoneDocumentCollectionResponseDto {
  milestone: MilestoneDocumentCollectionMilestoneResponseDto;
  documents: readonly MilestoneDocumentCollectionDocumentResponseDto[];
  rows: readonly MilestoneDocumentCollectionRowResponseDto[];
  page: number;
  pageSize: number;

  total: number;
  filterCounts: MilestoneDocumentCollectionFilterCountsResponseDto;
  documentTotals: readonly MilestoneDocumentCollectionDocumentTotalResponseDto[];

  private constructor(
    milestone: MilestoneContext,
    documents: readonly MilestoneDocumentRecord[],
    collection: MilestoneDocumentCollectionPage<
      MilestoneDocumentCollectionApplication,
      MilestoneDocumentCollectionSubmission
    >,
  ) {
    this.milestone = {
      id: milestone.id,
      programId: milestone.programId,
      name: milestone.name,
      dueAt: milestone.dueAt.toISOString(),
    };
    this.documents = documents.map((document) => ({
      id: document.id,
      name: document.name,
      isRequired: document.required,
      sortOrder: document.sortOrder,
    }));
    this.documentTotals = collection.documentTotals;
    this.filterCounts = collection.filterCounts;
    this.page = collection.page;
    this.pageSize = collection.pageSize;
    this.total = collection.total;

    this.rows = collection.rows.map((row) => ({
      applicationId: row.application.applicationId,
      teamName: row.application.teamName,
      applicantName: row.application.applicantName,
      memberNicknames: row.application.memberNicknames,
      cells: documents.map((document, index) =>
        toCell(document, row.cells[index] ?? null),
      ),
    }));
  }

  static from(
    milestone: MilestoneContext,
    documents: readonly MilestoneDocumentRecord[],
    collection: MilestoneDocumentCollectionPage<
      MilestoneDocumentCollectionApplication,
      MilestoneDocumentCollectionSubmission
    >,
  ): MilestoneDocumentCollectionResponseDto {
    return new MilestoneDocumentCollectionResponseDto(
      milestone,
      documents,
      collection,
    );
  }
}

export interface MilestoneDocumentDeliveryCollectionResponseDto extends Omit<
  MilestoneDocumentCollectionResponseDto,
  'rows'
> {
  readonly rows: readonly (MilestoneDocumentCollectionRowResponseDto & {
    readonly deliveryStatus: DocumentDeliveryStatus;
  })[];
  readonly deliveryCounts: {
    readonly missing: number;
    readonly late: number;
    readonly complete: number;
    readonly noRequiredItems: number;
  };
}

function toCell(
  document: MilestoneDocumentRecord,
  submission: MilestoneDocumentCollectionSubmission | null,
): MilestoneDocumentCollectionCellResponseDto {
  if (submission === null) {
    return {
      documentId: document.id,
      isSubmitted: false,
      submittedAt: null,
      revision: null,
      file: null,
      content: null,
      status: null,
      review: null,
    };
  }
  const file =
    submission.file === null
      ? null
      : {
          name: submission.file.originalFileName,
          sizeBytes: submission.file.sizeBytes,
        };
  return {
    documentId: document.id,
    isSubmitted: true,
    submittedAt: submission.submittedAt.toISOString(),
    revision: submission.revision,
    file,

    content: readMilestoneDocumentSubmittedContent(submission.content),
    status: submission.status,
    review:
      submission.review === null
        ? null
        : {
            id: submission.review.id,
            decision: submission.review.decision,
            comment: submission.review.comment,
            reviewedAt: submission.review.reviewedAt.toISOString(),
            resubmissionDueAt:
              submission.review.resubmissionDueAt?.toISOString() ?? null,
          },
  };
}
