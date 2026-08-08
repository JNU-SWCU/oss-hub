import { MilestoneSubmissionType } from '@prisma/client';
import type {
  MilestoneContext,
  MilestoneDocumentCollectionApplication,
  MilestoneDocumentCollectionSubmission,
  MilestoneDocumentRecord,
} from '../milestone-documents.repository';

export interface MilestoneDocumentCollectionMilestoneResponseDto {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
}

/** 표의 열 — 이 마일스톤이 요구하는 서류 항목. sortOrder 오름차순. */
export interface MilestoneDocumentCollectionDocumentResponseDto {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly submissionType: MilestoneSubmissionType;
}

export interface MilestoneDocumentCollectionFileResponseDto {
  readonly name: string;
  readonly sizeBytes: number;
}

/** 표의 칸 — 미제출이어도 칸을 비우지 않고 submitted:false로 채운다. */
export interface MilestoneDocumentCollectionCellResponseDto {
  readonly documentId: string;
  readonly submitted: boolean;
  readonly submittedAt: string | null;
  readonly file: MilestoneDocumentCollectionFileResponseDto | null;
}

/** 표의 행 — 승인된 신청(= 팀) 하나. */
export interface MilestoneDocumentCollectionRowResponseDto {
  readonly applicationId: string;
  readonly teamName: string;
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
  readonly cells: readonly MilestoneDocumentCollectionCellResponseDto[];
}

/**
 * `GET /milestones/:milestoneId/documents/collection` 응답 — 교직원 서류 수합 표.
 * cells는 documents 전부에 대해 한 칸씩 채운다: 프런트가 빈칸을 추측해 표를 그리지 않게 하려는
 * 의도적인 계약이다.
 */
export class MilestoneDocumentCollectionResponseDto {
  milestone: MilestoneDocumentCollectionMilestoneResponseDto;
  documents: readonly MilestoneDocumentCollectionDocumentResponseDto[];
  rows: readonly MilestoneDocumentCollectionRowResponseDto[];

  private constructor(
    milestone: MilestoneContext,
    documents: readonly MilestoneDocumentRecord[],
    applications: readonly MilestoneDocumentCollectionApplication[],
    submissions: readonly MilestoneDocumentCollectionSubmission[],
  ) {
    this.milestone = {
      id: milestone.id,
      name: milestone.name,
      dueAt: milestone.dueAt.toISOString(),
    };
    this.documents = documents.map((document) => ({
      id: document.id,
      name: document.name,
      required: document.required,
      sortOrder: document.sortOrder,
      submissionType: document.submissionType,
    }));

    // N+1 금지: 제출 목록을 한 번만 순회해 (신청, 서류) 키로 색인한 뒤 메모리에서 결합한다
    // (submissions/submission-matrix.service.ts의 cellIndex와 같은 방식).
    const cellIndex = new Map<string, MilestoneDocumentCollectionSubmission>();
    for (const submission of submissions) {
      cellIndex.set(
        cellKey(submission.applicationId, submission.milestoneDocumentId),
        submission,
      );
    }

    this.rows = applications.map((application) => ({
      applicationId: application.applicationId,
      teamName: application.teamName,
      applicantName: application.applicantName,
      memberNicknames: application.memberNicknames,
      cells: documents.map((document) =>
        toCell(
          document,
          cellIndex.get(cellKey(application.applicationId, document.id)) ??
            null,
        ),
      ),
    }));
  }

  static from(
    milestone: MilestoneContext,
    documents: readonly MilestoneDocumentRecord[],
    applications: readonly MilestoneDocumentCollectionApplication[],
    submissions: readonly MilestoneDocumentCollectionSubmission[],
  ): MilestoneDocumentCollectionResponseDto {
    return new MilestoneDocumentCollectionResponseDto(
      milestone,
      documents,
      applications,
      submissions,
    );
  }
}

function cellKey(applicationId: string, documentId: string): string {
  return `${applicationId}::${documentId}`;
}

function toCell(
  document: MilestoneDocumentRecord,
  submission: MilestoneDocumentCollectionSubmission | null,
): MilestoneDocumentCollectionCellResponseDto {
  if (submission === null) {
    return {
      documentId: document.id,
      submitted: false,
      submittedAt: null,
      file: null,
    };
  }
  // file은 FILE 유형에만 붙는다 — TEXT/REPOSITORY_RELEASE 제출은 첨부 없이 content만 갖는다.
  const file =
    document.submissionType === MilestoneSubmissionType.FILE &&
    submission.file !== null
      ? {
          name: submission.file.originalFileName,
          sizeBytes: submission.file.sizeBytes,
        }
      : null;
  return {
    documentId: document.id,
    submitted: true,
    submittedAt: submission.submittedAt.toISOString(),
    file,
  };
}
