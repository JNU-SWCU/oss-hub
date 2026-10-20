import type { SubmissionMatrixResult } from '../domain/submission-matrix-result';

import type {
  MatrixApplicationMode,
  MatrixCellStatus,
} from '../domain/submission-matrix';
import type { DocumentDeliveryStatus } from '../domain/document-delivery-status';

interface MatrixMilestoneResponseDto {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
}

export interface MatrixCellResponseDto {
  readonly milestoneId: string;
  readonly submissionId: string | null;
  readonly revision: number | null;
  readonly status: MatrixCellStatus;
  readonly submittedAt: string | null;
  readonly reviewUrl: string | null;
  readonly deliveryStatus: DocumentDeliveryStatus;
  readonly changesRequestedCount: number;
}

export interface MatrixRowResponseDto {
  readonly applicationId: string;
  readonly applicationMode: MatrixApplicationMode;
  readonly displayName: string;
  readonly githubLogins: readonly string[];
  readonly cells: readonly MatrixCellResponseDto[];
}

export interface SubmissionMatrixResponseDto {
  readonly milestones: readonly MatrixMilestoneResponseDto[];
  readonly rows: readonly MatrixRowResponseDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export function presentSubmissionMatrix(
  result: SubmissionMatrixResult,
  programId: string,
): SubmissionMatrixResponseDto {
  return {
    milestones: result.milestones.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      dueAt: milestone.dueAt.toISOString(),
    })),
    rows: result.rows.map((row) => ({
      applicationId: row.applicationId,
      applicationMode: row.applicationMode,
      displayName: row.displayName,
      githubLogins: row.githubLogins,
      cells: row.cells.map((cell) => ({
        milestoneId: cell.milestoneId,
        submissionId: cell.submissionId,
        revision: cell.revision,
        status: cell.status,
        submittedAt: cell.submittedAt?.toISOString() ?? null,
        reviewUrl:
          cell.submissionId === null
            ? null
            : `/programs/${programId}/submissions/${cell.submissionId}/review`,
        deliveryStatus: cell.deliveryStatus,
        changesRequestedCount: cell.changesRequestedCount,
      })),
    })),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  };
}
