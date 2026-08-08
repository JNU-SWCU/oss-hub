import type { ReviewDecision } from '@prisma/client';
import { MilestoneSubmissionType } from '@prisma/client';
import type { MilestoneDocumentCollectionPage } from '../domain/milestone-document-collection-page';
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

/**
 * 표의 열 — 이 마일스톤이 요구하는 서류 항목. sortOrder 오름차순.
 *
 * `isRequired`는 ADR-004의 boolean `is`/`has`/`can` 접두사 규칙이다. 같은 뜻을 담은
 * `MilestoneDocumentResponseDto.required`(기존 목록 조회 응답)가 접두사 없이 남아 있는 것은
 * 그쪽이 **이미 발행돼 학생·편집 화면이 쓰는 계약**이기 때문이다 — 이 수합 표 응답은 아직
 * 발행 전이라 지금 규칙에 맞춘다. 셀의 `submitted` → `isSubmitted`를 가른 것과 같은 기준이다
 * (발행된 계약은 그대로 두고 신규 응답만 규칙을 따른다). 이름이 비슷하다고 함께 바꾸면
 * 학생·편집 화면이 조용히 깨진다.
 */
export interface MilestoneDocumentCollectionDocumentResponseDto {
  readonly id: string;
  readonly name: string;
  readonly isRequired: boolean;
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
  /**
   * 최신 판정. 아직 판정하지 않았거나 미제출이면 null.
   *
   * ⚠ 이건 **표시값이지 업무 규칙이 아니다**. 「미제출」 판정 기준은 여전히 「제출 행이 없다」
   * (`isSubmitted`)이고, 필터·집계는 이 값을 보지 않는다 —
   * `domain/milestone-document-collection-page.ts`가 그 규칙을 소유한다. 반려된 서류를 「미제출」로
   * 세기 시작하면 독촉 대상 집계가 조용히 뜻을 바꾼다.
   */
  readonly review: MilestoneDocumentCollectionReviewResponseDto | null;
}

/** 칸에 붙는 최신 판정 — 교직원 표는 결과(`decision`)를 함께 보여 준다. */
export interface MilestoneDocumentCollectionReviewResponseDto {
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;
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
 * 이 클래스는 **전송 매핑만** 한다 — 필터 판정·집계·페이지 자르기는
 * `domain/milestone-document-collection-page.ts`가 이미 끝낸 뒤 넘어온다(ADR-003: 업무 규칙은
 * DTO가 아니라 service/도메인이 소유한다). 필드가 무엇을 세는지(집계는 전체 기준, `total`은
 * 필터 적용 후 행 수)의 근거도 그 파일에 있다.
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
    collection: MilestoneDocumentCollectionPage<
      MilestoneDocumentCollectionApplication,
      MilestoneDocumentCollectionSubmission
    >,
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
      isRequired: document.required,
      sortOrder: document.sortOrder,
      submissionType: document.submissionType,
    }));
    this.documentTotals = collection.documentTotals;
    this.filterCounts = collection.filterCounts;
    this.page = collection.page;
    this.pageSize = collection.pageSize;
    this.total = collection.total;
    // cells는 documents와 같은 순서다 — 도메인이 열 순서를 그렇게 세워 넘긴다.
    this.rows = collection.rows.map((row) => ({
      applicationId: row.application.applicationId,
      teamName: row.application.teamName,
      applicantName: row.application.applicantName,
      memberNicknames: row.application.memberNicknames,
      cells: documents.map((document, index) =>
        toCell(document, row.cells[index] ?? null),
      ),
    }));
  }

  static from(
    milestone: MilestoneContext,
    documents: readonly MilestoneDocumentRecord[],
    collection: MilestoneDocumentCollectionPage<
      MilestoneDocumentCollectionApplication,
      MilestoneDocumentCollectionSubmission
    >,
  ): MilestoneDocumentCollectionResponseDto {
    return new MilestoneDocumentCollectionResponseDto(
      milestone,
      documents,
      collection,
    );
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
      review: null,
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
    review:
      submission.review === null
        ? null
        : {
            decision: submission.review.decision,
            comment: submission.review.comment,
            reviewedAt: submission.review.reviewedAt.toISOString(),
          },
  };
}
