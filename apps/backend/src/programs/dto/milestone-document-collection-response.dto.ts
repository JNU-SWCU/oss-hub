import type {
  MilestoneDocumentCollectionResult,
  MilestoneDocumentDeliveryCollectionResult,
  MilestoneContext,
  MilestoneDocumentCollectionSubmission,
  MilestoneDocumentRecord,
} from '../milestone-document-result.types';
import type { ReviewDecision, SubmissionStatus } from '@prisma/client';
import {
  type DocumentDeliveryStatus,
  type MilestoneDocumentSubmittedContent,
  readMilestoneDocumentSubmittedContent,
} from '../milestone-document.policy';

export class MilestoneDocumentCollectionMilestoneResponseDto {
  declare readonly id: string;

  declare readonly programId: string;
  declare readonly name: string;
  declare readonly dueAt: string;

  static from(
    milestone: MilestoneContext,
  ): MilestoneDocumentCollectionMilestoneResponseDto {
    return {
      id: milestone.id,
      programId: milestone.programId,
      name: milestone.name,
      dueAt: milestone.dueAt.toISOString(),
    };
  }
}

export class MilestoneDocumentCollectionDocumentResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly isRequired: boolean;
  declare readonly sortOrder: number;

  static from(
    document: MilestoneDocumentRecord,
  ): MilestoneDocumentCollectionDocumentResponseDto {
    return {
      id: document.id,
      name: document.name,
      isRequired: document.required,
      sortOrder: document.sortOrder,
    };
  }
}

export class MilestoneDocumentCollectionFileResponseDto {
  declare readonly name: string;
  declare readonly sizeBytes: number;

  static from(
    file: NonNullable<MilestoneDocumentCollectionSubmission['file']>,
  ): MilestoneDocumentCollectionFileResponseDto {
    return { name: file.originalFileName, sizeBytes: file.sizeBytes };
  }
}

export class MilestoneDocumentCollectionReviewResponseDto {
  declare readonly id: string;
  declare readonly decision: ReviewDecision;
  declare readonly comment: string | null;
  declare readonly reviewedAt: string;

  declare readonly resubmissionDueAt: string | null;

  static from(
    review: NonNullable<MilestoneDocumentCollectionSubmission['review']>,
  ): MilestoneDocumentCollectionReviewResponseDto {
    return {
      id: review.id,
      decision: review.decision,
      comment: review.comment,
      reviewedAt: review.reviewedAt.toISOString(),
      resubmissionDueAt: review.resubmissionDueAt?.toISOString() ?? null,
    };
  }
}

export class MilestoneDocumentCollectionCellResponseDto {
  declare readonly documentId: string;
  declare readonly isSubmitted: boolean;
  declare readonly submittedAt: string | null;

  declare readonly revision: number | null;
  declare readonly file: MilestoneDocumentCollectionFileResponseDto | null;

  declare readonly content: MilestoneDocumentSubmittedContent | null;

  declare readonly status: SubmissionStatus | null;

  declare readonly review: MilestoneDocumentCollectionReviewResponseDto | null;

  static from(
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
    return {
      documentId: document.id,
      isSubmitted: true,
      submittedAt: submission.submittedAt.toISOString(),
      revision: submission.revision,
      file:
        submission.file === null
          ? null
          : MilestoneDocumentCollectionFileResponseDto.from(submission.file),

      content: readMilestoneDocumentSubmittedContent(submission.content),
      status: submission.status,
      review:
        submission.review === null
          ? null
          : MilestoneDocumentCollectionReviewResponseDto.from(
              submission.review,
            ),
    };
  }
}

export class MilestoneDocumentCollectionRowResponseDto {
  declare readonly applicationId: string;
  declare readonly teamName: string;
  declare readonly applicantName: string | null;
  declare readonly memberNicknames: readonly string[];
  declare readonly cells: readonly MilestoneDocumentCollectionCellResponseDto[];

  static from(
    row: MilestoneDocumentCollectionResult['rows'][number],
    documents: readonly MilestoneDocumentRecord[],
  ): MilestoneDocumentCollectionRowResponseDto {
    return {
      applicationId: row.application.applicationId,
      teamName: row.application.teamName,
      applicantName: row.application.applicantName,
      memberNicknames: row.application.memberNicknames,
      cells: documents.map((document, index) =>
        MilestoneDocumentCollectionCellResponseDto.from(
          document,
          row.cells[index] ?? null,
        ),
      ),
    };
  }
}

export class MilestoneDocumentCollectionFilterCountsResponseDto {
  declare readonly all: number;
  declare readonly hasMissing: number;
  declare readonly zeroSubmission: number;
}

export class MilestoneDocumentCollectionDocumentTotalResponseDto {
  declare readonly documentId: string;
  declare readonly submitted: number;
  declare readonly total: number;
}

export class MilestoneDocumentCollectionResponseDto {
  declare readonly milestone: MilestoneDocumentCollectionMilestoneResponseDto;
  declare readonly documents: readonly MilestoneDocumentCollectionDocumentResponseDto[];
  declare readonly rows: readonly MilestoneDocumentCollectionRowResponseDto[];
  declare readonly page: number;
  declare readonly pageSize: number;

  declare readonly total: number;
  declare readonly filterCounts: MilestoneDocumentCollectionFilterCountsResponseDto;
  declare readonly documentTotals: readonly MilestoneDocumentCollectionDocumentTotalResponseDto[];

  static from(
    result: MilestoneDocumentCollectionResult,
  ): MilestoneDocumentCollectionResponseDto {
    return {
      milestone: MilestoneDocumentCollectionMilestoneResponseDto.from(
        result.milestone,
      ),
      documents: result.documents.map((document) =>
        MilestoneDocumentCollectionDocumentResponseDto.from(document),
      ),
      rows: result.rows.map((row) =>
        MilestoneDocumentCollectionRowResponseDto.from(row, result.documents),
      ),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      filterCounts: result.filterCounts,
      documentTotals: result.documentTotals,
    };
  }
}

export class MilestoneDocumentDeliveryCollectionRowResponseDto {
  declare readonly applicationId: string;
  declare readonly teamName: string;
  declare readonly applicantName: string | null;
  declare readonly memberNicknames: readonly string[];
  declare readonly cells: readonly MilestoneDocumentCollectionCellResponseDto[];
  declare readonly deliveryStatus: DocumentDeliveryStatus;

  static from(
    row: MilestoneDocumentCollectionRowResponseDto,
    deliveryStatus: DocumentDeliveryStatus,
  ): MilestoneDocumentDeliveryCollectionRowResponseDto {
    return { ...row, deliveryStatus };
  }
}

export class MilestoneDocumentDeliveryCollectionResponseDto {
  declare readonly milestone: MilestoneDocumentCollectionMilestoneResponseDto;
  declare readonly documents: readonly MilestoneDocumentCollectionDocumentResponseDto[];
  declare readonly rows: readonly MilestoneDocumentDeliveryCollectionRowResponseDto[];
  declare readonly page: number;
  declare readonly pageSize: number;

  declare readonly total: number;
  declare readonly filterCounts: MilestoneDocumentCollectionFilterCountsResponseDto;
  declare readonly documentTotals: readonly MilestoneDocumentCollectionDocumentTotalResponseDto[];
  declare readonly deliveryCounts: {
    readonly missing: number;
    readonly late: number;
    readonly complete: number;
    readonly noRequiredItems: number;
  };

  static from(
    result: MilestoneDocumentDeliveryCollectionResult,
  ): MilestoneDocumentDeliveryCollectionResponseDto {
    const response = MilestoneDocumentCollectionResponseDto.from(result);
    return {
      ...response,
      deliveryCounts: result.deliveryCounts,
      rows: response.rows.map((row, index) => {
        const coordinateRow = result.rows[index];
        if (coordinateRow === undefined)
          throw new Error('Collection row mapping lost its source');
        return MilestoneDocumentDeliveryCollectionRowResponseDto.from(
          row,
          coordinateRow.deliveryStatus,
        );
      }),
    };
  }
}
