import type {
  SubmissionMatrixResult,
  MatrixApplicationMode,
  MatrixCellStatus,
} from '../submission.types';
import type { DocumentDeliveryStatus } from '../milestone-document.policy';

export class MatrixMilestoneResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly dueAt: string;

  static from(
    milestone: SubmissionMatrixResult['milestones'][number],
  ): MatrixMilestoneResponseDto {
    return {
      id: milestone.id,
      name: milestone.name,
      dueAt: milestone.dueAt.toISOString(),
    };
  }
}

export class MatrixCellResponseDto {
  declare readonly milestoneId: string;
  declare readonly submissionId: string | null;
  declare readonly revision: number | null;
  declare readonly status: MatrixCellStatus;
  declare readonly submittedAt: string | null;
  declare readonly reviewUrl: string | null;
  declare readonly deliveryStatus: DocumentDeliveryStatus;
  declare readonly changesRequestedCount: number;

  static from(
    cell: SubmissionMatrixResult['rows'][number]['cells'][number],
    programId: string,
  ): MatrixCellResponseDto {
    return {
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
    };
  }
}

export class MatrixRowResponseDto {
  declare readonly applicationId: string;
  declare readonly applicationMode: MatrixApplicationMode;
  declare readonly displayName: string;
  declare readonly githubLogins: readonly string[];
  declare readonly cells: readonly MatrixCellResponseDto[];

  static from(
    row: SubmissionMatrixResult['rows'][number],
    programId: string,
  ): MatrixRowResponseDto {
    return {
      applicationId: row.applicationId,
      applicationMode: row.applicationMode,
      displayName: row.displayName,
      githubLogins: row.githubLogins,
      cells: row.cells.map((cell) =>
        MatrixCellResponseDto.from(cell, programId),
      ),
    };
  }
}

export class SubmissionMatrixResponseDto {
  declare readonly milestones: readonly MatrixMilestoneResponseDto[];
  declare readonly rows: readonly MatrixRowResponseDto[];
  declare readonly page: number;
  declare readonly pageSize: number;
  declare readonly total: number;

  static from(
    result: SubmissionMatrixResult,
    programId: string,
  ): SubmissionMatrixResponseDto {
    return {
      milestones: result.milestones.map((milestone) =>
        MatrixMilestoneResponseDto.from(milestone),
      ),
      rows: result.rows.map((row) => MatrixRowResponseDto.from(row, programId)),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }
}
