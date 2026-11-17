import type {
  SubmissionMatrixResult,
  MatrixCellStatus,
} from '../submission-matrix.service';
import type { MatrixApplicationMode } from '../submissions.repository';
import type { DocumentDeliveryStatus } from '../requirements.repository';

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
  declare readonly deliveryStatus: DocumentDeliveryStatus;
  declare readonly changesRequestedCount: number;

  static from(
    cell: SubmissionMatrixResult['rows'][number]['cells'][number],
  ): MatrixCellResponseDto {
    return {
      milestoneId: cell.milestoneId,
      submissionId: cell.submissionId,
      revision: cell.revision,
      status: cell.status,
      submittedAt: cell.submittedAt?.toISOString() ?? null,
      deliveryStatus: cell.deliveryStatus,
      changesRequestedCount: cell.changesRequestedCount,
    };
  }
}

export class MatrixRowResponseDto {
  declare readonly teamId: string;
  declare readonly applicationMode: MatrixApplicationMode;
  declare readonly displayName: string;
  declare readonly githubLogins: string[];
  declare readonly cells: MatrixCellResponseDto[];

  static from(
    row: SubmissionMatrixResult['rows'][number],
  ): MatrixRowResponseDto {
    return {
      teamId: row.teamId,
      applicationMode: row.applicationMode,
      displayName: row.displayName,
      githubLogins: [...row.githubLogins],
      cells: row.cells.map((cell) => MatrixCellResponseDto.from(cell)),
    };
  }
}

export class SubmissionMatrixResponseDto {
  declare readonly milestones: MatrixMilestoneResponseDto[];
  declare readonly rows: MatrixRowResponseDto[];
  declare readonly page: number;
  declare readonly pageSize: number;
  declare readonly total: number;

  static from(result: SubmissionMatrixResult): SubmissionMatrixResponseDto {
    return {
      milestones: result.milestones.map((milestone) =>
        MatrixMilestoneResponseDto.from(milestone),
      ),
      rows: result.rows.map((row) => MatrixRowResponseDto.from(row)),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }
}
