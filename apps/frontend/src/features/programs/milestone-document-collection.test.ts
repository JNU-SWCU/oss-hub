import { describe, expect, it } from 'vitest';
import {
  collectionCellFor,
  collectionDocumentTotalFor,
  collectionEmptyKind,
  collectionFilterCountFor,
  collectionRowMemberSummary,
  MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS,
  milestoneDocumentCollectionTotalPages,
} from './milestone-document-collection';
import type { MilestoneDocumentCollectionRow } from './milestone-document-collection-api';

/**
 * 계약 변경(2026-08): 필터 판정과 합계 셈이 서버로 넘어갔다. 그래서 예전에 여기 있던
 * `applyCollectionFilter`·`collectionFilterCount`·`documentSubmissionTotals`와
 * `rowHasMissingDocument`·`rowSubmittedNothing`의 테스트는 지웠다 — 함수 자체가 없다.
 * 그 자리에 서버가 준 값을 **골라 오기만 하는지** 보는 테스트를 둔다. 클라이언트가
 * 다시 세면 손에 있는 것이 한 페이지뿐이라 반드시 틀린 수가 나온다.
 */

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

describe('MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS', () => {
  // 이 필터는 필수 서류만 센다. 「미제출 있는 팀」은 선택 서류까지 세는 것처럼 읽혀
  // 독촉 대상을 과하게 잡은 것으로 오해를 부른다 — 문구가 기준을 드러내야 한다.
  it('필수 기준임이 문구에 드러난다', () => {
    expect(MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS.HAS_MISSING).toContain(
      '필수',
    );
    expect(MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS.HAS_MISSING).not.toBe(
      '미제출 있는 팀',
    );
  });
});

describe('collectionFilterCountFor', () => {
  const counts = { all: 47, hasMissing: 12, zeroSubmission: 5 };

  it('필터마다 서버가 준 수를 그대로 고른다', () => {
    expect(collectionFilterCountFor(counts, 'ALL')).toBe(47);
    expect(collectionFilterCountFor(counts, 'HAS_MISSING')).toBe(12);
    expect(collectionFilterCountFor(counts, 'ZERO_SUBMISSION')).toBe(5);
  });

  // 필터 칩의 수는 이 마일스톤 전체 기준이다. 페이지에 있는 행으로 세면 페이지
  // 크기(20)를 넘는 순간 「전체 20팀」으로 굳는다.
  it('페이지 크기와 무관하게 전체 기준 수를 낸다', () => {
    expect(collectionFilterCountFor(counts, 'ALL')).toBeGreaterThan(20);
  });
});

describe('collectionDocumentTotalFor', () => {
  const totals = [
    { documentId: 'd1', submitted: 30, total: 47 },
    { documentId: 'd2', submitted: 12, total: 47 },
  ];

  it('서류마다 서버가 준 합계를 고른다', () => {
    expect(collectionDocumentTotalFor(totals, 'd2')).toEqual({
      documentId: 'd2',
      submitted: 12,
      total: 47,
    });
  });

  // 열과 합계의 수가 어긋나도 표가 칸을 밀어 그리면 남의 열에 남의 합계가 앉는다.
  it('합계가 없는 서류는 0/0으로 메운다', () => {
    expect(collectionDocumentTotalFor(totals, 'd9')).toEqual({
      documentId: 'd9',
      submitted: 0,
      total: 0,
    });
  });
});

describe('milestoneDocumentCollectionTotalPages', () => {
  it('나머지가 있으면 한 페이지를 더 센다', () => {
    expect(milestoneDocumentCollectionTotalPages(47, 20)).toBe(3);
    expect(milestoneDocumentCollectionTotalPages(40, 20)).toBe(2);
  });

  it('행이 없으면 페이지도 없다', () => {
    expect(milestoneDocumentCollectionTotalPages(0, 20)).toBe(0);
  });

  it('pageSize가 0이면 나누지 않는다', () => {
    expect(milestoneDocumentCollectionTotalPages(10, 0)).toBe(0);
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
    expect(
      collectionEmptyKind({
        documentCount: 0,
        applicationCount: 0,
        filteredCount: 0,
      }),
    ).toBe('no-documents');
  });

  it('서류는 있는데 승인된 신청이 없으면 신청 없음이다', () => {
    expect(
      collectionEmptyKind({
        documentCount: 2,
        applicationCount: 0,
        filteredCount: 0,
      }),
    ).toBe('no-applications');
  });

  /**
   * 계약 변경으로 갈래가 하나 늘었다. `rows.length`로 판정하던 예전 방식은 이제
   * 「필터에 아무도 안 걸렸다」를 「승인된 신청이 없다」로 잘못 말한다 — 신청이 47팀
   * 있어도 ZERO_SUBMISSION에 0팀이면 rows가 비기 때문이다. 그래서 신청 유무는
   * 필터 이전의 전체로, 필터 결과 유무는 total로 나눠 본다.
   */
  it('신청은 있는데 필터에 아무도 안 걸리면 신청 없음이 아니다', () => {
    expect(
      collectionEmptyKind({
        documentCount: 2,
        applicationCount: 47,
        filteredCount: 0,
      }),
    ).toBe('no-filter-results');
  });

  it('걸린 팀이 있으면 빈 화면이 아니다', () => {
    expect(
      collectionEmptyKind({
        documentCount: 2,
        applicationCount: 47,
        filteredCount: 3,
      }),
    ).toBeNull();
  });
});
