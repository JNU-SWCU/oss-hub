import type { Readable } from 'node:stream';
import type {
  SubmissionStatus,
  ApplicationStatus,
  MilestoneSubmissionType,
  ReviewDecision,
} from '@prisma/client';
import type { DocumentDeliveryStatus } from './milestone-document.policy';

export interface SubmissionFileUpload {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
}

export interface UploadedSubmissionFileResponse {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}

export interface DownloadedSubmissionFile {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentLength: number;
}

export const MATRIX_APPLICATION_MODES = ['PERSONAL', 'TEAM'] as const;

export type MatrixApplicationMode = (typeof MATRIX_APPLICATION_MODES)[number];

export interface SubmissionMatrixFilter {
  readonly q: string;
  readonly applicationMode: MatrixApplicationMode | null;
}

export interface SubmissionMatrixQuery extends SubmissionMatrixFilter {
  readonly page: number;
  readonly pageSize: number;
}

export type MatrixCellStatus = SubmissionStatus | 'NOT_SUBMITTED';

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

export interface SubmissionApplication {
  readonly id: string;
  readonly programId: string;
  readonly teamId: string | null;

  readonly teamMemberCount: number;
  readonly status: ApplicationStatus;
  readonly existingSubmission: {
    readonly id: string;
    readonly status: SubmissionStatus;
  } | null;
}

interface ChecklistLatestReview {
  readonly decision: ReviewDecision;
  readonly reviewedAt: Date;
  readonly comment: string | null;
}

export interface SubmissionFileMetadata {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: Date;
}

export interface ChecklistMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly submission: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly currentRevision: number;
    readonly latestReview: ChecklistLatestReview | null;
    readonly file: SubmissionFileMetadata | null;
  } | null;
}
