/**
 * 교직원 서류 수합 표의 **업무 규칙** — 행 필터 판정(HAS_MISSING·ZERO_SUBMISSION), 집계
 * (filterCounts·documentTotals), 페이지 자르기.
 *
 * ADR-003의 「업무 규칙은 service에 두고 DTO와 도메인 모델을 분리한다」에 따라 응답 DTO가 아니라
 * 여기에 둔다. 응답 매핑을 고치다가 「누가 독촉 대상인가」가 함께 바뀌면 안 되기 때문이다.
 * 순수 함수라 Prisma·Nest·DTO 어디에도 기대지 않는다.
 *
 * 입력 타입을 제네릭으로 받는 이유: 판정에 필요한 것은 서류의 `required`와 「이 칸에 제출이
 * 있는가」뿐이고, 신청·제출 객체의 나머지 필드(팀 이름·첨부 등)는 직렬화 단계에서만 쓰인다.
 * 도메인이 리포지토리 레코드 전체를 알 필요가 없으면서도, 행을 다시 결합하지 않고 그대로
 * 넘겨줄 수 있다.
 */
import type { MilestoneDocumentCollectionQuery } from './milestone-document-collection-query';

/** 판정에 필요한 서류 항목의 최소 속성 — 필수 여부만 본다. */
export interface MilestoneDocumentCollectionDocumentRule {
  readonly id: string;
  readonly required: boolean;
}

/** 판정에 필요한 신청(행)의 최소 속성. */
export interface MilestoneDocumentCollectionApplicationRule {
  readonly applicationId: string;
}

/** 판정에 필요한 제출의 최소 속성 — (행, 열) 좌표. */
export interface MilestoneDocumentCollectionSubmissionRule {
  readonly applicationId: string;
  readonly milestoneDocumentId: string;
}

/**
 * 표의 한 행 — 승인된 신청 하나. `cells[i]`는 `documents[i]`에 대한 제출이며 미제출이면 null이다.
 * **열 순서가 documents와 같다**는 것이 이 타입의 계약이다(직렬화 쪽도 같은 순서로 읽는다).
 */
export interface MilestoneDocumentCollectionPageRow<
  TApplication extends MilestoneDocumentCollectionApplicationRule,
  TSubmission extends MilestoneDocumentCollectionSubmissionRule,
> {
  readonly application: TApplication;
  readonly cells: readonly (TSubmission | null)[];
}

/** 필터 칩에 붙는 건수 — 필터를 바꾸기 전에 몇 팀이 걸리는지 미리 보여 준다. */
export interface MilestoneDocumentCollectionFilterCounts {
  readonly all: number;
  readonly hasMissing: number;
  readonly zeroSubmission: number;
}

/** 합계 행 — 서류(열) 하나의 진척. total은 승인된 신청 수(= 전체 행 수)다. */
export interface MilestoneDocumentCollectionDocumentTotal {
  readonly documentId: string;
  readonly submitted: number;
  readonly total: number;
}

/**
 * 필터·집계·페이지 자르기를 끝낸 수합 표. 응답 DTO는 이 값을 **직렬화만** 한다.
 *
 * ⚠ 집계 두 필드(filterCounts·documentTotals)는 **필터·페이지와 무관하게 전체 승인 신청 기준**이다.
 * 화면의 합계 행이 「지금 걸러 놓은 것」이 아니라 「이 마일스톤 전체 진척」을 말해야 하기 때문이다.
 * 필터를 따라가게 만들면 ZERO_SUBMISSION에서 모든 열이 「제출 0」이 되어 뜻이 없어진다.
 * 반대로 `total`은 **필터 적용 후** 행 수다(페이지 이동에 쓰는 값이라 그래야 한다).
 */
export interface MilestoneDocumentCollectionPage<
  TApplication extends MilestoneDocumentCollectionApplicationRule,
  TSubmission extends MilestoneDocumentCollectionSubmissionRule,
> {
  readonly rows: readonly MilestoneDocumentCollectionPageRow<
    TApplication,
    TSubmission
  >[];
  readonly page: number;
  readonly pageSize: number;
  /** 필터 적용 후 행 수(페이지 slice 전). */
  readonly total: number;
  readonly filterCounts: MilestoneDocumentCollectionFilterCounts;
  readonly documentTotals: readonly MilestoneDocumentCollectionDocumentTotal[];
}

/**
 * 승인된 신청 전부로 행을 만들고 → 집계하고 → 필터·페이지를 적용한다. **이 순서가 규칙이다** —
 * 집계(filterCounts·documentTotals)가 필터·페이지 이전의 전체를 봐야 하므로 자르는 것은 맨 뒤다.
 *
 * 정렬은 리포지토리가 팀 이름 asc → id asc로 이미 확정했다. 여기서 다시 정렬하지 않아야
 * 페이지 경계가 흔들리지 않는다.
 */
export function buildMilestoneDocumentCollectionPage<
  TDocument extends MilestoneDocumentCollectionDocumentRule,
  TApplication extends MilestoneDocumentCollectionApplicationRule,
  TSubmission extends MilestoneDocumentCollectionSubmissionRule,
>(
  documents: readonly TDocument[],
  applications: readonly TApplication[],
  submissions: readonly TSubmission[],
  query: MilestoneDocumentCollectionQuery,
): MilestoneDocumentCollectionPage<TApplication, TSubmission> {
  // N+1 금지: 제출 목록을 한 번만 순회해 (신청, 서류) 키로 색인한 뒤 메모리에서 결합한다
  // (submissions/submission-matrix.service.ts의 cellIndex와 같은 방식).
  const cellIndex = new Map<string, TSubmission>();
  for (const submission of submissions) {
    cellIndex.set(
      cellKey(submission.applicationId, submission.milestoneDocumentId),
      submission,
    );
  }

  const allRows: readonly MilestoneDocumentCollectionPageRow<
    TApplication,
    TSubmission
  >[] = applications.map((application) => ({
    application,
    cells: documents.map(
      (document) =>
        cellIndex.get(cellKey(application.applicationId, document.id)) ?? null,
    ),
  }));

  const documentTotals = documents.map((document, index) => ({
    documentId: document.id,
    submitted: allRows.filter((row) => isSubmittedAt(row, index)).length,
    total: allRows.length,
  }));
  const filterCounts = {
    all: allRows.length,
    hasMissing: allRows.filter((row) => hasMissingRequired(row, documents))
      .length,
    zeroSubmission: allRows.filter((row) => hasZeroSubmission(row, documents))
      .length,
  };

  const filtered = allRows.filter((row) =>
    matchesFilter(row, documents, query.filter),
  );
  const offset = (query.page - 1) * query.pageSize;
  return {
    rows: filtered.slice(offset, offset + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
    filterCounts,
    documentTotals,
  };
}

function cellKey(applicationId: string, documentId: string): string {
  return `${applicationId}::${documentId}`;
}

function isSubmittedAt(
  row: MilestoneDocumentCollectionPageRow<
    MilestoneDocumentCollectionApplicationRule,
    MilestoneDocumentCollectionSubmissionRule
  >,
  index: number,
): boolean {
  return (row.cells[index] ?? null) !== null;
}

/**
 * 독촉 대상 — 필수 서류 중 하나라도 미제출. 선택 서류는 세지 않는다.
 * 필수 서류가 하나도 없으면 아무 팀도 걸리지 않는다.
 */
function hasMissingRequired(
  row: MilestoneDocumentCollectionPageRow<
    MilestoneDocumentCollectionApplicationRule,
    MilestoneDocumentCollectionSubmissionRule
  >,
  documents: readonly MilestoneDocumentCollectionDocumentRule[],
): boolean {
  return documents.some(
    (document, index) => document.required && !isSubmittedAt(row, index),
  );
}

/**
 * 한 장도 안 낸 팀 — 필수·선택을 가리지 않는다. 서류 항목이 0개면 아무 팀도 걸리지 않는다
 * (「낼 것이 없다」를 「0건 제출」로 셈하지 않는다).
 */
function hasZeroSubmission(
  row: MilestoneDocumentCollectionPageRow<
    MilestoneDocumentCollectionApplicationRule,
    MilestoneDocumentCollectionSubmissionRule
  >,
  documents: readonly MilestoneDocumentCollectionDocumentRule[],
): boolean {
  return documents.length > 0 && row.cells.every((cell) => cell === null);
}

function matchesFilter(
  row: MilestoneDocumentCollectionPageRow<
    MilestoneDocumentCollectionApplicationRule,
    MilestoneDocumentCollectionSubmissionRule
  >,
  documents: readonly MilestoneDocumentCollectionDocumentRule[],
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
