import type { DocumentDeliveryStatus } from './document-delivery-status.policy';
import type {
  MatrixApplicationMode,
  MatrixCellStatus,
} from './submission-matrix.types';

export interface MatrixCellResult {
  readonly milestoneId: string;
  readonly submissionId: string | null;
  readonly revision: number | null;
  readonly status: MatrixCellStatus;
  readonly submittedAt: Date | null;
  readonly deliveryStatus: DocumentDeliveryStatus;
  readonly changesRequestedCount: number;
}

export interface MatrixRowResult {
  readonly applicationId: string;
  readonly applicationMode: MatrixApplicationMode;
  readonly displayName: string;
  readonly githubLogins: readonly string[];
  readonly cells: readonly MatrixCellResult[];
}

export interface SubmissionMatrixResult {
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly dueAt: Date;
  }[];
  readonly rows: readonly MatrixRowResult[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}
