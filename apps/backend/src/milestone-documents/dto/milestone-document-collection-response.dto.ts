import { MilestoneSubmissionType } from '@prisma/client';
import type { MilestoneDocumentCollectionQuery } from '../domain/milestone-document-collection-query';
import type {
  MilestoneContext,
  MilestoneDocumentCollectionApplication,
  MilestoneDocumentCollectionSubmission,
  MilestoneDocumentRecord,
} from '../milestone-documents.repository';

export interface MilestoneDocumentCollectionMilestoneResponseDto {
  readonly id: string;
  /**
   * 화면 경로가 `/programs/{programId}/milestones/{milestoneId}/documents`인데 이 요청은
   * milestoneId만 보낸다. 경로의 programId와 대조할 근거를 프런트에 주려고 싣는다 —
   * 이 값이 다르면 다른 프로그램의 수합 표라는 뜻이다.
   */
  readonly programId: string;
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

/**
 * 표의 칸 — 미제출이어도 칸을 비우지 않고 isSubmitted:false로 채운다.
 *
 * boolean 필드가 `is` 접두사를 쓰는 것은 ADR-004 규칙이다. 같은 모듈의
 * `MilestoneDocumentViewerSubmissionResponseDto.submitted`가 접두사 없이 남아 있는 것은
 * 그쪽이 이미 발행돼 학생 화면이 쓰는 계약이기 때문이다 — 이 수합 표 계약은 아직 발행 전이라
 * 지금 규칙에 맞춘다(뒤에 깨는 변경을 만들지 않으려는 의도적인 비대칭이다).
 */
export interface MilestoneDocumentCollectionCellResponseDto {
  readonly documentId: string;
  readonly isSubmitted: boolean;
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

/** 필터 칩에 붙는 건수 — 필터를 바꾸기 전에 몇 팀이 걸리는지 미리 보여 준다. */
export interface MilestoneDocumentCollectionFilterCountsResponseDto {
  readonly all: number;
  readonly hasMissing: number;
  readonly zeroSubmission: number;
}

/** 표의 합계 행 — 서류(열) 하나의 진척. total은 승인된 신청 수(= 전체 행 수)다. */
export interface MilestoneDocumentCollectionDocumentTotalResponseDto {
  readonly documentId: string;
  readonly submitted: number;
  readonly total: number;
}

/**
 * `GET /milestones/:milestoneId/documents/collection` 응답 — 교직원 서류 수합 표.
 * cells는 documents 전부에 대해 한 칸씩 채운다: 프런트가 빈칸을 추측해 표를 그리지 않게 하려는
 * 의도적인 계약이다.
 *
 * ⚠ 집계 두 필드(filterCounts·documentTotals)는 **필터·페이지와 무관하게 전체 승인 신청 기준**이다.
 * 화면의 합계 행이 「지금 걸러 놓은 것」이 아니라 「이 마일스톤 전체 진척」을 말해야 하기 때문이다.
 * 필터를 따라가게 만들면 ZERO_SUBMISSION에서 모든 열이 「제출 0」이 되어 뜻이 없어진다.
 * 반대로 `total`은 **필터 적용 후** 행 수다(페이지 이동에 쓰는 값이라 그래야 한다).
 */
export class MilestoneDocumentCollectionResponseDto {
  milestone: MilestoneDocumentCollectionMilestoneResponseDto;
  documents: readonly MilestoneDocumentCollectionDocumentResponseDto[];
  rows: readonly MilestoneDocumentCollectionRowResponseDto[];
  page: number;
  pageSize: number;
  /** 필터 적용 후 행 수(페이지 slice 전). */
  total: number;
  filterCounts: MilestoneDocumentCollectionFilterCountsResponseDto;
  documentTotals: readonly MilestoneDocumentCollectionDocumentTotalResponseDto[];

  private constructor(
    milestone: MilestoneContext,
    documents: readonly MilestoneDocumentRecord[],
    applications: readonly MilestoneDocumentCollectionApplication[],
    submissions: readonly MilestoneDocumentCollectionSubmission[],
    query: MilestoneDocumentCollectionQuery,
  ) {
    this.milestone = {
      id: milestone.id,
      programId: milestone.programId,
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

    // 승인 신청 전부로 행을 먼저 만든다 — 집계(filterCounts·documentTotals)가 필터·페이지
    // 이전의 전체를 봐야 하기 때문이다. 필터·slice는 그 다음이다.
    const allRows: MilestoneDocumentCollectionRowResponseDto[] =
      applications.map((application) => ({
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

    this.documentTotals = documents.map((document, index) => ({
      documentId: document.id,
      submitted: allRows.filter((row) => row.cells[index]?.isSubmitted === true)
        .length,
      total: allRows.length,
    }));
    this.filterCounts = {
      all: allRows.length,
      hasMissing: allRows.filter((row) => hasMissingRequired(row, documents))
        .length,
      zeroSubmission: allRows.filter((row) => hasZeroSubmission(row, documents))
        .length,
    };

    const filtered = allRows.filter((row) =>
      matchesFilter(row, documents, query.filter),
    );
    this.page = query.page;
    this.pageSize = query.pageSize;
    this.total = filtered.length;
    // 정렬은 리포지토리가 팀 이름 asc → id asc로 이미 확정했다. 여기서 다시 정렬하지 않아야
    // 페이지 경계가 흔들리지 않는다.
    const offset = (query.page - 1) * query.pageSize;
    this.rows = filtered.slice(offset, offset + query.pageSize);
  }

  static from(
    milestone: MilestoneContext,
    documents: readonly MilestoneDocumentRecord[],
    applications: readonly MilestoneDocumentCollectionApplication[],
    submissions: readonly MilestoneDocumentCollectionSubmission[],
    query: MilestoneDocumentCollectionQuery,
  ): MilestoneDocumentCollectionResponseDto {
    return new MilestoneDocumentCollectionResponseDto(
      milestone,
      documents,
      applications,
      submissions,
      query,
    );
  }
}

function cellKey(applicationId: string, documentId: string): string {
  return `${applicationId}::${documentId}`;
}

/**
 * 독촉 대상 — 필수 서류 중 하나라도 미제출. 선택 서류는 세지 않는다.
 * 필수 서류가 하나도 없으면 아무 팀도 걸리지 않는다.
 */
function hasMissingRequired(
  row: MilestoneDocumentCollectionRowResponseDto,
  documents: readonly MilestoneDocumentRecord[],
): boolean {
  return documents.some(
    (document, index) =>
      document.required && row.cells[index]?.isSubmitted !== true,
  );
}

/**
 * 한 장도 안 낸 팀 — 필수·선택을 가리지 않는다. 서류 항목이 0개면 아무 팀도 걸리지 않는다
 * (「낼 것이 없다」를 「0건 제출」로 셈하지 않는다).
 */
function hasZeroSubmission(
  row: MilestoneDocumentCollectionRowResponseDto,
  documents: readonly MilestoneDocumentRecord[],
): boolean {
  return documents.length > 0 && row.cells.every((cell) => !cell.isSubmitted);
}

function matchesFilter(
  row: MilestoneDocumentCollectionRowResponseDto,
  documents: readonly MilestoneDocumentRecord[],
  filter: MilestoneDocumentCollectionQuery['filter'],
): boolean {
  switch (filter) {
    case 'HAS_MISSING':
      return hasMissingRequired(row, documents);
    case 'ZERO_SUBMISSION':
      return hasZeroSubmission(row, documents);
    case 'ALL':
      return true;
  }
}

function toCell(
  document: MilestoneDocumentRecord,
  submission: MilestoneDocumentCollectionSubmission | null,
): MilestoneDocumentCollectionCellResponseDto {
  if (submission === null) {
    return {
      documentId: document.id,
      isSubmitted: false,
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
    isSubmitted: true,
    submittedAt: submission.submittedAt.toISOString(),
    file,
  };
}
