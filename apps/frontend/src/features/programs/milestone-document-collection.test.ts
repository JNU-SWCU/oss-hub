import { describe, expect, it } from 'vitest';
import {
  applyCollectionFilter,
  collectionCellFor,
  collectionEmptyKind,
  collectionFilterCount,
  collectionRowMemberSummary,
  documentSubmissionTotals,
  rowHasMissingDocument,
  rowSubmittedNothing,
} from './milestone-document-collection';
import type {
  MilestoneDocumentCollectionDocument,
  MilestoneDocumentCollectionRow,
} from './milestone-document-collection-api';

function document(
  id: string,
  overrides: Partial<MilestoneDocumentCollectionDocument> = {},
): MilestoneDocumentCollectionDocument {
  return {
    id,
    name: `서류 ${id}`,
    required: true,
    sortOrder: 1,
    submissionType: 'FILE',
    ...overrides,
  };
}

/** `submitted[i]`가 i번째 서류의 제출 여부다 — 계약대로 미제출 칸도 채워 넣는다. */
function row(
  applicationId: string,
  submitted: readonly boolean[],
  overrides: Partial<MilestoneDocumentCollectionRow> = {},
): MilestoneDocumentCollectionRow {
  return {
    applicationId,
    teamName: `${applicationId}팀`,
    applicantName: '김철수',
    memberNicknames: ['chulsoo'],
    cells: submitted.map((isSubmitted, index) => ({
      documentId: `d${index + 1}`,
      submitted: isSubmitted,
      submittedAt: isSubmitted ? '2026-07-28T00:00:00.000Z' : null,
      file: null,
    })),
    ...overrides,
  };
}

describe('rowHasMissingDocument / rowSubmittedNothing', () => {
  it('한 장이라도 빠지면 미제출 있는 팀이다', () => {
    expect(rowHasMissingDocument(row('a', [true, false]))).toBe(true);
  });

  it('전부 냈으면 미제출 있는 팀이 아니다', () => {
    expect(rowHasMissingDocument(row('a', [true, true]))).toBe(false);
  });

  // 두 필터가 갈리는 지점 — 한 장이라도 낸 팀은 「한 장도 안 낸 팀」이 아니다.
  it('일부만 낸 팀은 미제출 있는 팀이지만 한 장도 안 낸 팀은 아니다', () => {
    const partial = row('a', [true, false]);

    expect(rowHasMissingDocument(partial)).toBe(true);
    expect(rowSubmittedNothing(partial)).toBe(false);
  });

  it('전부 안 냈으면 한 장도 안 낸 팀이다', () => {
    expect(rowSubmittedNothing(row('a', [false, false]))).toBe(true);
  });

  // 칸이 없으면 "안 냈다"고 말할 근거가 없다 — 서류 0개 마일스톤에서 모든 팀이
  // 이 필터에 걸리면 화면이 없는 문제를 만들어 낸다.
  it('칸이 하나도 없는 행은 한 장도 안 낸 팀으로 세지 않는다', () => {
    expect(rowSubmittedNothing(row('a', []))).toBe(false);
  });
});

describe('applyCollectionFilter / collectionFilterCount', () => {
  const rows = [
    row('all', [true, true]),
    row('partial', [true, false]),
    row('none', [false, false]),
  ];

  it('전체는 행을 그대로 둔다', () => {
    expect(applyCollectionFilter(rows, 'ALL')).toEqual(rows);
  });

  it('미제출 있는 팀은 일부만 낸 팀과 아무것도 안 낸 팀을 함께 남긴다', () => {
    expect(
      applyCollectionFilter(rows, 'HAS_MISSING').map(
        (item) => item.applicationId,
      ),
    ).toEqual(['partial', 'none']);
  });

  it('한 장도 안 낸 팀은 아무것도 안 낸 팀만 남긴다', () => {
    expect(
      applyCollectionFilter(rows, 'ZERO_SUBMISSION').map(
        (item) => item.applicationId,
      ),
    ).toEqual(['none']);
  });

  it('버튼에 붙는 수는 필터를 적용한 행 수와 같다', () => {
    expect(collectionFilterCount(rows, 'ALL')).toBe(3);
    expect(collectionFilterCount(rows, 'HAS_MISSING')).toBe(2);
    expect(collectionFilterCount(rows, 'ZERO_SUBMISSION')).toBe(1);
  });
});

describe('documentSubmissionTotals', () => {
  it('서류마다 제출 팀 수와 전체 팀 수를 센다', () => {
    const totals = documentSubmissionTotals(
      [document('d1'), document('d2')],
      [
        row('a', [true, true]),
        row('b', [true, false]),
        row('c', [false, false]),
      ],
    );

    expect(totals).toEqual([
      { documentId: 'd1', submitted: 2, total: 3 },
      { documentId: 'd2', submitted: 1, total: 3 },
    ]);
  });

  it('행이 없으면 분모도 0이다', () => {
    expect(documentSubmissionTotals([document('d1')], [])).toEqual([
      { documentId: 'd1', submitted: 0, total: 0 },
    ]);
  });

  // 계약상 칸은 다 채워져 오지만, 빠진 칸을 제출로 세면 합계가 조용히 부풀어 오른다.
  it('칸이 빠진 행은 그 서류를 미제출로 센다', () => {
    const totals = documentSubmissionTotals(
      [document('d1'), document('d2')],
      [row('a', [true])],
    );

    expect(totals).toEqual([
      { documentId: 'd1', submitted: 1, total: 1 },
      { documentId: 'd2', submitted: 0, total: 1 },
    ]);
  });
});

describe('collectionCellFor', () => {
  it('빠진 칸은 미제출로 메운다', () => {
    expect(collectionCellFor(row('a', [true]), 'd9')).toEqual({
      documentId: 'd9',
      submitted: false,
      submittedAt: null,
      file: null,
    });
  });
});

describe('collectionRowMemberSummary', () => {
  it('여러 명이면 신청자 이름에 나머지 인원을 붙인다', () => {
    expect(
      collectionRowMemberSummary(
        row('a', [true], {
          applicantName: '김철수',
          memberNicknames: ['chulsoo', 'younghee', 'minsu'],
        }),
      ),
    ).toBe('김철수 외 2명');
  });

  it('1인 팀에는 「외 N명」을 붙이지 않는다', () => {
    expect(
      collectionRowMemberSummary(
        row('a', [true], {
          applicantName: '김철수',
          memberNicknames: ['chulsoo'],
        }),
      ),
    ).toBe('김철수');
  });

  it('프로필을 안 채운 신청자는 첫 GitHub 계정으로 대체한다', () => {
    expect(
      collectionRowMemberSummary(
        row('a', [true], {
          applicantName: null,
          memberNicknames: ['chulsoo', 'younghee'],
        }),
      ),
    ).toBe('chulsoo 외 1명');
  });

  it('이름도 계정도 없으면 아무 표기도 만들지 않는다 — 팀 이름만 남는다', () => {
    expect(
      collectionRowMemberSummary(
        row('a', [true], { applicantName: null, memberNicknames: [] }),
      ),
    ).toBeNull();
  });
});

describe('collectionEmptyKind', () => {
  it('서류 항목이 없으면 그것을 먼저 알린다', () => {
    expect(collectionEmptyKind({ documentCount: 0, rowCount: 0 })).toBe(
      'no-documents',
    );
  });

  it('서류는 있는데 승인된 신청이 없으면 신청 없음이다', () => {
    expect(collectionEmptyKind({ documentCount: 2, rowCount: 0 })).toBe(
      'no-applications',
    );
  });

  it('둘 다 있으면 빈 화면이 아니다', () => {
    expect(collectionEmptyKind({ documentCount: 2, rowCount: 3 })).toBeNull();
  });
});
