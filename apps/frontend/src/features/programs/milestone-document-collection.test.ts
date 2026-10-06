import { describe, expect, it } from 'vitest';
import {
  collectionCellFor,
  collectionDocumentTotalFor,
  collectionEmptyKind,
  collectionFilterCountFor,
  collectionRowMemberSummary,
  isCollectionProgramMismatch,
  MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS,
  milestoneDocumentCollectionDataFor,
  milestoneDocumentCollectionLoadPhase,
  milestoneDocumentCollectionPageState,
  milestoneDocumentCollectionTotalPages,
} from './milestone-document-collection';
import type {
  MilestoneDocumentCollection,
  MilestoneDocumentCollectionQueryInput,
  MilestoneDocumentCollectionRow,
} from './milestone-document-collection-api';

function row(
  applicationId: string,
  submitted: readonly boolean[],
  overrides: Partial<MilestoneDocumentCollectionRow> = {},
): MilestoneDocumentCollectionRow {
  return {
    applicationId,
    deliveryStatus: 'MISSING',
    teamName: `${applicationId}팀`,
    applicantName: '김철수',
    memberNicknames: ['chulsoo'],
    cells: submitted.map((isSubmitted, index) => ({
      documentId: `d${index + 1}`,
      isSubmitted,
      status: isSubmitted ? ('SUBMITTED' as const) : null,
      revision: isSubmitted ? 1 : null,
      submittedAt: isSubmitted ? '2026-07-28T00:00:00.000Z' : null,
      file: null,
      content: null,
      review: null,
    })),
    ...overrides,
  };
}

describe('MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS', () => {
  it('필수 기준임이 문구에 드러난다', () => {
    expect(MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS.HAS_MISSING).toBe(
      '미제출 있음',
    );
    expect(MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS.HAS_MISSING).not.toBe(
      '미제출 있는 팀',
    );
  });
});

describe('collectionFilterCountFor', () => {
  const counts = { all: 47, hasMissing: 12, zeroSubmission: 5 };

  it('필터마다 서버가 준 수를 그대로 고른다', () => {
    expect(
      collectionFilterCountFor(counts, 'ALL', {
        missing: 12,
        late: 10,
        complete: 20,
        noRequiredItems: 5,
      }),
    ).toBe(47);
    expect(
      collectionFilterCountFor(counts, 'HAS_MISSING', {
        missing: 12,
        late: 10,
        complete: 20,
        noRequiredItems: 5,
      }),
    ).toBe(12);
    expect(
      collectionFilterCountFor(counts, 'ZERO_SUBMISSION', {
        missing: 12,
        late: 10,
        complete: 20,
        noRequiredItems: 5,
      }),
    ).toBe(5);
  });

  it('페이지 크기와 무관하게 전체 기준 수를 낸다', () => {
    expect(
      collectionFilterCountFor(counts, 'ALL', {
        missing: 12,
        late: 10,
        complete: 20,
        noRequiredItems: 5,
      }),
    ).toBeGreaterThan(20);
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

describe('milestoneDocumentCollectionPageState', () => {
  it('페이지가 결과 안에 있으면 아무 일도 하지 않는다', () => {
    expect(
      milestoneDocumentCollectionPageState({
        page: 2,
        total: 47,
        pageSize: 20,
      }),
    ).toEqual({ totalPages: 3, lastPage: 3, outOfRange: false });
  });

  it('마지막 페이지에 딱 걸치면 밖으로 밀려난 것이 아니다', () => {
    expect(
      milestoneDocumentCollectionPageState({
        page: 3,
        total: 47,
        pageSize: 20,
      }),
    ).toMatchObject({ outOfRange: false });
  });

  it('결과가 줄어 페이지가 사라지면 남은 마지막 페이지를 가리킨다', () => {
    expect(
      milestoneDocumentCollectionPageState({ page: 2, total: 5, pageSize: 20 }),
    ).toEqual({ totalPages: 1, lastPage: 1, outOfRange: true });
  });

  it('여러 페이지가 남아 있으면 1페이지가 아니라 마지막 페이지로 내려앉는다', () => {
    expect(
      milestoneDocumentCollectionPageState({
        page: 30,
        total: 570,
        pageSize: 20,
      }),
    ).toEqual({ totalPages: 29, lastPage: 29, outOfRange: true });
  });

  it('결과가 아예 없으면 밀려난 페이지로 보지 않는다', () => {
    expect(
      milestoneDocumentCollectionPageState({ page: 2, total: 0, pageSize: 20 }),
    ).toEqual({ totalPages: 0, lastPage: 1, outOfRange: false });
  });
});

describe('milestoneDocumentCollectionDataFor', () => {
  const query = {
    page: 1,
    pageSize: 20,
    filter: 'ALL',
  } satisfies MilestoneDocumentCollectionQueryInput;
  const data = {
    milestone: {
      id: 'm1',
      programId: 'program-capstone',
      name: '기획서 제출',
      dueAt: '2026-07-15T14:59:59Z',
    },
    documents: [],
    rows: [],
    page: 1,
    pageSize: 20,
    total: 0,
    deliveryCounts: { missing: 12, late: 10, complete: 20, noRequiredItems: 5 },
    filterCounts: { all: 0, hasMissing: 0, zeroSubmission: 0 },
    documentTotals: [],
  } satisfies MilestoneDocumentCollection;

  it('조건이 같으면 그대로 그린다', () => {
    expect(
      milestoneDocumentCollectionDataFor({ query, data }, { ...query }),
    ).toBe(data);
  });

  it('필터가 바뀌면 옛 응답을 내주지 않는다', () => {
    expect(
      milestoneDocumentCollectionDataFor(
        { query, data },
        { ...query, filter: 'HAS_MISSING' },
      ),
    ).toBeNull();
  });

  it('페이지가 바뀌어도 마찬가지다', () => {
    expect(
      milestoneDocumentCollectionDataFor(
        { query, data },
        { ...query, page: 2 },
      ),
    ).toBeNull();
  });

  it('아직 아무것도 못 받았으면 그릴 것이 없다', () => {
    expect(milestoneDocumentCollectionDataFor(null, query)).toBeNull();
  });

  describe('milestoneDocumentCollectionLoadPhase', () => {
    it('부르는 중이 아니면 idle이다', () => {
      expect(
        milestoneDocumentCollectionLoadPhase({ data, isLoading: false }),
      ).toBe('idle');
      expect(
        milestoneDocumentCollectionLoadPhase({ data: null, isLoading: false }),
      ).toBe('idle');
    });

    it('그릴 표가 없는 채로 부르는 중이면 뼈대다', () => {
      expect(
        milestoneDocumentCollectionLoadPhase({ data: null, isLoading: true }),
      ).toBe('skeleton');
    });

    it('같은 조건의 재조회는 표를 두고 뒤에서 갱신한다', () => {
      expect(
        milestoneDocumentCollectionLoadPhase({ data, isLoading: true }),
      ).toBe('refreshing');
    });

    it('조건이 바뀐 조회는 옛 표를 유지하지 않는다', () => {
      const changed = { ...query, filter: 'HAS_MISSING' as const };
      expect(
        milestoneDocumentCollectionLoadPhase({
          data: milestoneDocumentCollectionDataFor({ query, data }, changed),
          isLoading: true,
        }),
      ).toBe('skeleton');
    });
  });
});

describe('collectionCellFor', () => {
  it('있는 칸은 그 칸의 제출 여부를 그대로 준다', () => {
    expect(collectionCellFor(row('a', [true, false]), 'd1')).toMatchObject({
      documentId: 'd1',
      isSubmitted: true,
    });
    expect(collectionCellFor(row('a', [true, false]), 'd2')).toMatchObject({
      documentId: 'd2',
      isSubmitted: false,
    });
  });

  it('빠진 칸은 상태도 번호도 판정도 본문도 없는 미제출로 메운다', () => {
    expect(collectionCellFor(row('a', [true]), 'd9')).toEqual({
      documentId: 'd9',
      isSubmitted: false,
      status: null,

      revision: null,
      submittedAt: null,
      file: null,
      content: null,
      review: null,
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

describe('isCollectionProgramMismatch', () => {
  it('경로의 프로그램과 응답의 프로그램이 같으면 어긋난 것이 아니다', () => {
    expect(
      isCollectionProgramMismatch({
        programId: 'program-capstone',
        milestoneProgramId: 'program-capstone',
      }),
    ).toBe(false);
  });

  it('다른 프로그램의 마일스톤이면 어긋난 것으로 본다', () => {
    expect(
      isCollectionProgramMismatch({
        programId: 'program-capstone',
        milestoneProgramId: 'program-basic-study',
      }),
    ).toBe(true);
  });
});

describe('collectionEmptyKind', () => {
  const sameProgram = {
    programId: 'program-capstone',
    milestoneProgramId: 'program-capstone',
  };

  it('경로의 프로그램과 응답의 프로그램이 다르면 표를 그리지 않는다', () => {
    expect(
      collectionEmptyKind({
        programId: 'program-capstone',
        milestoneProgramId: 'program-basic-study',
        documentCount: 3,
        applicationCount: 47,
        filteredCount: 47,
      }),
    ).toBe('wrong-program');
  });

  it('프로그램이 어긋나면 다른 빈 상태보다 먼저 걸린다', () => {
    expect(
      collectionEmptyKind({
        programId: 'program-capstone',
        milestoneProgramId: 'program-basic-study',
        documentCount: 0,
        applicationCount: 0,
        filteredCount: 0,
      }),
    ).toBe('wrong-program');
  });

  it('서류 항목이 없으면 그것을 먼저 알린다', () => {
    expect(
      collectionEmptyKind({
        ...sameProgram,
        documentCount: 0,
        applicationCount: 0,
        filteredCount: 0,
      }),
    ).toBe('no-documents');
  });

  it('서류는 있는데 승인된 신청이 없으면 신청 없음이다', () => {
    expect(
      collectionEmptyKind({
        ...sameProgram,
        documentCount: 2,
        applicationCount: 0,
        filteredCount: 0,
      }),
    ).toBe('no-applications');
  });

  it('신청은 있는데 필터에 아무도 안 걸리면 신청 없음이 아니다', () => {
    expect(
      collectionEmptyKind({
        ...sameProgram,
        documentCount: 2,
        applicationCount: 47,
        filteredCount: 0,
      }),
    ).toBe('no-filter-results');
  });

  it('걸린 팀이 있으면 빈 화면이 아니다', () => {
    expect(
      collectionEmptyKind({
        ...sameProgram,
        documentCount: 2,
        applicationCount: 47,
        filteredCount: 3,
      }),
    ).toBeNull();
  });
});
