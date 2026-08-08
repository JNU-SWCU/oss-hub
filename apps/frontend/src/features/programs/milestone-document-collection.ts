import type {
  MilestoneDocumentCollectionCell,
  MilestoneDocumentCollectionDocumentTotal,
  MilestoneDocumentCollectionFilter,
  MilestoneDocumentCollectionFilterCounts,
  MilestoneDocumentCollectionRow,
} from './milestone-document-collection-api';

/**
 * 서류 수합 표의 **표시** 로직. 팀 표시 이름·빈칸 메우기·빈 화면 구분처럼 화면이
 * 알아서 정할 수 있는 것만 여기 있다.
 *
 * ⚠ 필터 판정과 합계 셈은 **여기 없다 — 서버가 한다**. 응답의 `rows`가 페이지 한 장
 * 분량으로 바뀌면서 클라이언트가 세면 반드시 틀린 수가 나오기 때문이다(21팀짜리
 * 마일스톤에서 「전체 20팀」이 되고, 2페이지에서는 「전체 1팀」이 된다). 이전에 여기
 * 있던 `applyCollectionFilter`·`collectionFilterCount`·`documentSubmissionTotals`는
 * 그래서 지웠다. 필터별 팀 수는 `filterCounts`, 합계 행은 `documentTotals`를 그대로 쓴다.
 */

export const MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS = {
  ALL: '전체',
  // ⚠ 「미제출 있는 팀」이 아니다. 이 필터는 **필수 서류만** 센다 — 선택 서류를 안 낸
  // 팀은 걸리지 않는다. 예전 문구는 선택 서류까지 세는 것처럼 읽혀 오해를 불렀다.
  HAS_MISSING: '필수 서류 미제출',
  ZERO_SUBMISSION: '한 장도 안 낸 팀',
} as const satisfies Readonly<
  Record<MilestoneDocumentCollectionFilter, string>
>;

/**
 * 계약상 `cells`는 `documents` 전부에 대해 한 칸씩 채워져 오지만, 빠진 칸이 있어도
 * 행 전체가 어긋나지 않도록 미제출로 메운다 — 표가 열을 밀어 그리면 다른 팀의
 * 제출물이 남의 칸에 보인다.
 */
export function collectionCellFor(
  row: MilestoneDocumentCollectionRow,
  documentId: string,
): MilestoneDocumentCollectionCell {
  return (
    row.cells.find((cell) => cell.documentId === documentId) ?? {
      documentId,
      submitted: false,
      submittedAt: null,
      file: null,
    }
  );
}

/**
 * 필터 버튼에 함께 적는 팀 수 — **서버가 준 값에서 골라 오기만 한다.**
 * 버튼을 눌러 보지 않아도 규모를 알 수 있게 하는 표기이고, 그 수는 페이지가 아니라
 * 이 마일스톤 전체를 기준으로 해야 뜻이 있다.
 */
export function collectionFilterCountFor(
  counts: MilestoneDocumentCollectionFilterCounts,
  filter: MilestoneDocumentCollectionFilter,
): number {
  switch (filter) {
    case 'HAS_MISSING':
      return counts.hasMissing;
    case 'ZERO_SUBMISSION':
      return counts.zeroSubmission;
    case 'ALL':
      return counts.all;
  }
}

/**
 * 합계 행 한 칸 — 서버가 준 `documentTotals`에서 그 서류의 값을 찾는다. 없으면 0/0으로
 * 메운다: 열과 합계의 수가 어긋나도 표가 칸을 밀어 그리지 않게 하려는 것이다
 * (`collectionCellFor`와 같은 이유).
 */
export function collectionDocumentTotalFor(
  totals: readonly MilestoneDocumentCollectionDocumentTotal[],
  documentId: string,
): MilestoneDocumentCollectionDocumentTotal {
  return (
    totals.find((total) => total.documentId === documentId) ?? {
      documentId,
      submitted: 0,
      total: 0,
    }
  );
}

/** 페이지 이동 UI가 쓰는 마지막 페이지 번호(`submissions/matrix.ts`의 matrixTotalPages와 같은 규칙). */
export function milestoneDocumentCollectionTotalPages(
  total: number,
  pageSize: number,
): number {
  if (total <= 0 || pageSize <= 0) return 0;
  return Math.ceil(total / pageSize);
}

/**
 * 팀 이름 아래 작게 붙는 사람 표기 — 「{신청자} 외 N명」.
 *
 * 신청자 이름은 프로필 미작성이면 비어 오므로 첫 GitHub 계정으로 대체하고, 그것도
 * 없으면 `null`을 돌려 화면이 팀 이름만 그리게 한다. 1인 팀에 「외 0명」을 붙이면
 * 사람이 더 있는 것처럼 읽히므로 그때는 이름만 남긴다.
 */
export function collectionRowMemberSummary(
  row: MilestoneDocumentCollectionRow,
): string | null {
  const lead = row.applicantName ?? row.memberNicknames[0] ?? null;
  if (lead === null) return null;
  const others = Math.max(row.memberNicknames.length - 1, 0);
  return others === 0 ? lead : `${lead} 외 ${others}명`;
}

export type MilestoneDocumentCollectionEmptyKind =
  'no-documents' | 'no-applications' | 'no-filter-results' | null;

/**
 * 빈 화면 구분. 서류 항목 없음이 먼저다 — 신청이 없더라도 교직원이 할 일은
 * "서류 항목부터 등록"이고, 항목이 없으면 표의 열 자체가 서지 않는다.
 *
 * ⚠ 세는 대상이 바뀌었다. 예전에는 `rows.length`로 「신청 없음」을 판정했는데, 이제
 * `rows`는 필터를 지나 잘린 한 페이지라 **필터에 아무도 안 걸린 것**과 **승인된 신청이
 * 없는 것**을 구분하지 못한다. 신청 유무는 필터 이전의 전체(`filterCounts.all`),
 * 필터 결과 유무는 `total`로 본다.
 */
export function collectionEmptyKind(input: {
  readonly documentCount: number;
  /** 필터·페이지 이전의 전체 승인 신청 수 = 응답의 `filterCounts.all`. */
  readonly applicationCount: number;
  /** 필터 적용 후 행 수 = 응답의 `total`. */
  readonly filteredCount: number;
}): MilestoneDocumentCollectionEmptyKind {
  if (input.documentCount === 0) return 'no-documents';
  if (input.applicationCount === 0) return 'no-applications';
  if (input.filteredCount === 0) return 'no-filter-results';
  return null;
}
