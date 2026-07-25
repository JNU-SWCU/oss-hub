import type {
  MatrixApplicationMode,
  MatrixCellStatus,
} from '../domain/submission-matrix';

export interface MatrixMilestoneResponseDto {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
}

/** 미제출 cell은 submissionId·revision·submittedAt·reviewUrl이 모두 null이다(#124). */
export interface MatrixCellResponseDto {
  readonly milestoneId: string;
  readonly submissionId: string | null;
  readonly revision: number | null;
  readonly status: MatrixCellStatus;
  readonly submittedAt: string | null;
  readonly reviewUrl: string | null;
}

/** 행은 팀이 아니라 승인된 Application이다 — 개인형 teamId=null도 정상 행(#124 계약 잠금). */
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
