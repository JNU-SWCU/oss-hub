import type { SubmissionStatus } from '@prisma/client';
import type { RequirementCollectionResult } from '../requirements.service';
import type {
  RequirementDeliveryCollectionResult,
  RequirementCollectionCell,
} from '../requirement-archive.service';
import type {
  MilestoneContext,
  RequirementCollectionSubmission,
  RequirementRecord,
  DocumentDeliveryStatus,
  RequirementSubmittedContent,
} from '../requirements.repository';
import type { SubmissionReviewDecision } from '../submissions.repository';
export class RequirementCollectionMilestoneResponseDto {
  declare readonly id: string;
  declare readonly programId: string;
  declare readonly name: string;
  declare readonly dueAt: string;
  static from(
    milestone: MilestoneContext,
  ): RequirementCollectionMilestoneResponseDto {
    return {
      id: milestone.id,
      programId: milestone.programId,
      name: milestone.name,
      dueAt: milestone.dueAt.toISOString(),
    };
  }
}
export class RequirementCollectionDocumentResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly isRequired: boolean;
  declare readonly sortOrder: number;
  static from(
    document: RequirementRecord,
  ): RequirementCollectionDocumentResponseDto {
    return {
      id: document.id,
      name: document.name,
      isRequired: document.required,
      sortOrder: document.sortOrder,
    };
  }
}
export class RequirementCollectionFileResponseDto {
  declare readonly name: string;
  declare readonly sizeBytes: number;
  static from(
    file: NonNullable<RequirementCollectionSubmission['file']>,
  ): RequirementCollectionFileResponseDto {
    return { name: file.originalFileName, sizeBytes: file.sizeBytes };
  }
}
export class RequirementCollectionReviewResponseDto {
  declare readonly id: string;
  declare readonly decision: SubmissionReviewDecision;
  declare readonly comment: string | null;
  declare readonly reviewedAt: string;
  static from(
    review: NonNullable<RequirementCollectionSubmission['review']>,
  ): RequirementCollectionReviewResponseDto {
    return {
      id: review.id,
      decision: review.decision,
      comment: review.comment,
      reviewedAt: review.reviewedAt.toISOString(),
    };
  }
}
export class RequirementCollectionCellResponseDto {
  declare readonly documentId: string;
  declare readonly isSubmitted: boolean;
  declare readonly submittedAt: string | null;
  declare readonly revision: number | null;
  declare readonly file: RequirementCollectionFileResponseDto | null;
  declare readonly content: RequirementSubmittedContent | null;
  declare readonly status: SubmissionStatus | null;
  declare readonly review: RequirementCollectionReviewResponseDto | null;
  static from(
    document: RequirementRecord,
    submission: RequirementCollectionCell | null,
  ): RequirementCollectionCellResponseDto {
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
          : RequirementCollectionFileResponseDto.from(submission.file),
      content: submission.content,
      status: submission.status,
      review:
        submission.review === null
          ? null
          : RequirementCollectionReviewResponseDto.from(submission.review),
    };
  }
}
export class RequirementCollectionRowResponseDto {
  declare readonly teamId: string;
  declare readonly teamName: string;
  declare readonly applicantName: string | null;
  declare readonly memberNicknames: readonly string[];
  declare readonly cells: readonly RequirementCollectionCellResponseDto[];
  static from(
    row: RequirementCollectionResult['rows'][number],
    documents: readonly RequirementRecord[],
  ): RequirementCollectionRowResponseDto {
    return {
      teamId: row.application.teamId,
      teamName: row.application.teamName,
      applicantName: row.application.applicantName,
      memberNicknames: row.application.memberNicknames,
      cells: documents.map((document, index) =>
        RequirementCollectionCellResponseDto.from(
          document,
          row.cells[index] ?? null,
        ),
      ),
    };
  }
}
export class RequirementCollectionFilterCountsResponseDto {
  declare readonly all: number;
  declare readonly hasMissing: number;
  declare readonly zeroSubmission: number;
  static from(
    counts: RequirementCollectionResult['filterCounts'],
  ): RequirementCollectionFilterCountsResponseDto {
    return {
      all: counts.all,
      hasMissing: counts.hasMissing,
      zeroSubmission: counts.zeroSubmission,
    };
  }
}
export class RequirementCollectionDocumentTotalResponseDto {
  declare readonly documentId: string;
  declare readonly submitted: number;
  declare readonly total: number;
  static from(
    total: RequirementCollectionResult['documentTotals'][number],
  ): RequirementCollectionDocumentTotalResponseDto {
    return {
      documentId: total.documentId,
      submitted: total.submitted,
      total: total.total,
    };
  }
}
export class RequirementCollectionResponseDto {
  declare readonly milestone: RequirementCollectionMilestoneResponseDto;
  declare readonly documents: readonly RequirementCollectionDocumentResponseDto[];
  declare readonly rows: readonly RequirementCollectionRowResponseDto[];
  declare readonly page: number;
  declare readonly pageSize: number;
  declare readonly total: number;
  declare readonly filterCounts: RequirementCollectionFilterCountsResponseDto;
  declare readonly documentTotals: readonly RequirementCollectionDocumentTotalResponseDto[];
  static from(
    result: RequirementCollectionResult,
  ): RequirementCollectionResponseDto {
    return {
      milestone: RequirementCollectionMilestoneResponseDto.from(
        result.milestone,
      ),
      documents: result.documents.map((document) =>
        RequirementCollectionDocumentResponseDto.from(document),
      ),
      rows: result.rows.map((row) =>
        RequirementCollectionRowResponseDto.from(row, result.documents),
      ),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      filterCounts: RequirementCollectionFilterCountsResponseDto.from(
        result.filterCounts,
      ),
      documentTotals: result.documentTotals.map((total) =>
        RequirementCollectionDocumentTotalResponseDto.from(total),
      ),
    };
  }
}
export class RequirementDeliveryCollectionRowResponseDto {
  declare readonly teamId: string;
  declare readonly teamName: string;
  declare readonly applicantName: string | null;
  declare readonly memberNicknames: readonly string[];
  declare readonly cells: readonly RequirementCollectionCellResponseDto[];
  declare readonly deliveryStatus: DocumentDeliveryStatus;
  static from(
    row: RequirementCollectionRowResponseDto,
    deliveryStatus: DocumentDeliveryStatus,
  ): RequirementDeliveryCollectionRowResponseDto {
    return {
      teamId: row.teamId,
      teamName: row.teamName,
      applicantName: row.applicantName,
      memberNicknames: row.memberNicknames,
      cells: row.cells,
      deliveryStatus,
    };
  }
}
export class RequirementDeliveryCollectionResponseDto {
  declare readonly milestone: RequirementCollectionMilestoneResponseDto;
  declare readonly documents: readonly RequirementCollectionDocumentResponseDto[];
  declare readonly rows: readonly RequirementDeliveryCollectionRowResponseDto[];
  declare readonly page: number;
  declare readonly pageSize: number;
  declare readonly total: number;
  declare readonly filterCounts: RequirementCollectionFilterCountsResponseDto;
  declare readonly documentTotals: readonly RequirementCollectionDocumentTotalResponseDto[];
  declare readonly deliveryCounts: {
    readonly missing: number;
    readonly late: number;
    readonly complete: number;
    readonly noRequiredItems: number;
  };
  static from(
    result: RequirementDeliveryCollectionResult,
  ): RequirementDeliveryCollectionResponseDto {
    const response = RequirementCollectionResponseDto.from(result);
    return {
      milestone: response.milestone,
      documents: response.documents,
      rows: response.rows.map((row, index) => {
        const coordinateRow = result.rows[index];
        if (coordinateRow === undefined)
          throw new Error('Collection row mapping lost its source');
        return RequirementDeliveryCollectionRowResponseDto.from(
          row,
          coordinateRow.deliveryStatus,
        );
      }),
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      filterCounts: response.filterCounts,
      documentTotals: response.documentTotals,
      deliveryCounts: {
        missing: result.deliveryCounts.missing,
        late: result.deliveryCounts.late,
        complete: result.deliveryCounts.complete,
        noRequiredItems: result.deliveryCounts.noRequiredItems,
      },
    };
  }
}
