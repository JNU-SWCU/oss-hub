import type {
  MilestoneDocumentCollectionCell,
  MilestoneDocumentCollectionDocument,
  MilestoneDocumentCollectionRow,
} from './milestone-document-collection-api';

/**
 * 서류 수합 표의 순수 로직. 필터 판정·합계·팀 표시 이름은 전부 여기 있고 화면은
 * 결과만 그린다 — 같은 판정이 뷰와 컨테이너 양쪽에 생기면 두 곳이 서로 다르게
 * 세는 일이 조용히 생긴다(`features/submissions/matrix.ts`와 같은 분리).
 */

/** 빠른 필터 3종 — 「전체」·「미제출 있는 팀」·「한 장도 안 낸 팀」. */
export type MilestoneDocumentCollectionFilter =
  'ALL' | 'HAS_MISSING' | 'ZERO_SUBMISSION';

export const MILESTONE_DOCUMENT_COLLECTION_FILTERS: readonly MilestoneDocumentCollectionFilter[] =
  ['ALL', 'HAS_MISSING', 'ZERO_SUBMISSION'];

export const MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS = {
  ALL: '전체',
  HAS_MISSING: '미제출 있는 팀',
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

/** 한 장이라도 빠진 팀. 독촉 대상을 고르는 기준이다. */
export function rowHasMissingDocument(
  row: MilestoneDocumentCollectionRow,
): boolean {
  return row.cells.some((cell) => !cell.submitted);
}

/**
 * 아직 아무것도 내지 않은 팀. 칸이 하나도 없으면 "안 냈다"고 말할 근거가 없으므로
 * 제외한다 — 서류 항목이 0개인 마일스톤은 모든 팀이 이 필터에 걸려 버린다.
 */
export function rowSubmittedNothing(
  row: MilestoneDocumentCollectionRow,
): boolean {
  return row.cells.length > 0 && row.cells.every((cell) => !cell.submitted);
}

export function applyCollectionFilter(
  rows: readonly MilestoneDocumentCollectionRow[],
  filter: MilestoneDocumentCollectionFilter,
): readonly MilestoneDocumentCollectionRow[] {
  if (filter === 'HAS_MISSING') return rows.filter(rowHasMissingDocument);
  if (filter === 'ZERO_SUBMISSION') return rows.filter(rowSubmittedNothing);
  return rows;
}

/** 필터 버튼에 함께 적는 팀 수. 버튼을 눌러 보지 않아도 규모를 알 수 있게 한다. */
export function collectionFilterCount(
  rows: readonly MilestoneDocumentCollectionRow[],
  filter: MilestoneDocumentCollectionFilter,
): number {
  return applyCollectionFilter(rows, filter).length;
}

export interface MilestoneDocumentSubmissionTotal {
  readonly documentId: string;
  readonly submitted: number;
  readonly total: number;
}

/**
 * 표 아래 합계 행 — 서류마다 「제출 N / 전체 M」.
 *
 * 분모는 **빠른 필터와 무관하게 전체 팀 수**다. 마감을 판단하는 사람이 알고 싶은
 * 것은 지금 화면에 걸러 놓은 팀이 아니라 이 마일스톤을 통째로 봤을 때의 진척이며,
 * 필터에 따라 분모가 흔들리면 「제출 0 / 전체 12」 같은 자명한 값만 남는다.
 */
export function documentSubmissionTotals(
  documents: readonly MilestoneDocumentCollectionDocument[],
  rows: readonly MilestoneDocumentCollectionRow[],
): readonly MilestoneDocumentSubmissionTotal[] {
  return documents.map((document) => ({
    documentId: document.id,
    submitted: rows.filter(
      (row) => collectionCellFor(row, document.id).submitted,
    ).length,
    total: rows.length,
  }));
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
  'no-documents' | 'no-applications' | null;

/**
 * 빈 화면 구분. 서류 항목 없음이 먼저다 — 신청이 없더라도 교직원이 할 일은
 * "서류 항목부터 등록"이고, 항목이 없으면 표의 열 자체가 서지 않는다.
 */
export function collectionEmptyKind(input: {
  readonly documentCount: number;
  readonly rowCount: number;
}): MilestoneDocumentCollectionEmptyKind {
  if (input.documentCount === 0) return 'no-documents';
  if (input.rowCount === 0) return 'no-applications';
  return null;
}
