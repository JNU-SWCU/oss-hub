import type {
  MatrixApplicationMode,
  MatrixCellStatus,
} from '../domain/submission-matrix';
import type { DocumentDeliveryStatus } from '../document-delivery-status';

export interface MatrixMilestoneResponseDto {
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
