import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MilestoneDocumentCollectionView } from './milestone-document-collection-view';
import type { MilestoneDocumentCollectionViewProps } from './milestone-document-collection-view';
import type {
  MilestoneDocumentCollection,
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

function row(
  applicationId: string,
  cells: MilestoneDocumentCollectionRow['cells'],
  overrides: Partial<MilestoneDocumentCollectionRow> = {},
): MilestoneDocumentCollectionRow {
  return {
    applicationId,
    teamName: `${applicationId}팀`,
    applicantName: '김철수',
    memberNicknames: ['chulsoo', 'younghee'],
    cells,
    ...overrides,
  };
}

/**
 * 계약 변경(2026-08): 응답이 페이지 한 장 + 서버 집계로 바뀌었다. 픽스처도 그대로
 * 따른다 — 집계 두 필드는 **필터·페이지 이전의 전체 기준**이라 `rows`에서 파생하지
 * 않는다. 여기서 rows로부터 세어 채우면 「화면이 서버 값을 쓰는가」를 물을 수 없게 된다.
 */
function collection(
  documents: readonly MilestoneDocumentCollectionDocument[],
  rows: readonly MilestoneDocumentCollectionRow[],
  overrides: Partial<MilestoneDocumentCollection> = {},
): MilestoneDocumentCollection {
  return {
    milestone: {
      id: 'milestone-1',
      name: '기획서 제출',
      dueAt: '2026-07-15T14:59:59.000Z',
    },
    documents,
    rows,
    page: 1,
    pageSize: 20,
    total: rows.length,
    filterCounts: {
      all: rows.length,
      hasMissing: rows.length,
      zeroSubmission: rows.length,
    },
    documentTotals: documents.map((item) => ({
      documentId: item.id,
      submitted: 0,
      total: rows.length,
    })),
    ...overrides,
  };
}

function render(
  overrides: Partial<MilestoneDocumentCollectionViewProps> = {},
): string {
  return renderToStaticMarkup(
    <MilestoneDocumentCollectionView
      programId="program-capstone"
      data={collection([document('d1')], [])}
      filter="ALL"
      isLoading={false}
      errorMessage={null}
      onFilterChange={() => {}}
      onPageChange={() => {}}
      onRetry={() => {}}
      {...overrides}
    />,
  );
}

describe('MilestoneDocumentCollectionView 머리말', () => {
  it('제목에 마일스톤 이름을, 부제에 마감 시각을 적는다', () => {
    const html = render({
      data: collection(
        [document('d1')],
        [
          row('a', [
            {
              documentId: 'd1',
              submitted: false,
              submittedAt: null,
              file: null,
            },
          ]),
        ],
      ),
    });

    expect(html).toContain('서류 수합 — 기획서 제출');
    expect(html).toContain('2026년 7월 15일');
    expect(html).toContain('마감');
  });
});

describe('MilestoneDocumentCollectionView 빈 상태', () => {
  it('서류 항목이 없으면 프로그램 편집으로 보낸다', () => {
    const html = render({ data: collection([], []) });

    expect(html).toContain('이 마일스톤에는 등록된 서류 항목이 없습니다');
    expect(html).toContain('/programs/program-capstone/edit');
  });

  it('승인된 신청이 없으면 그렇게 알린다', () => {
    const html = render({ data: collection([document('d1')], []) });

    expect(html).toContain('아직 승인된 신청이 없습니다');
    expect(html).not.toContain('등록된 서류 항목이 없습니다');
  });

  it('불러오기에 실패하면 오류 문구와 다시 시도를 함께 낸다', () => {
    const html = render({
      data: null,
      errorMessage: '서류 수합 표를 불러오지 못했습니다.',
    });

    expect(html).toContain('서류 수합 표를 불러오지 못했습니다.');
    expect(html).toContain('다시 시도');
  });
});

describe('MilestoneDocumentCollectionView 표', () => {
  const documents = [
    document('d1', { name: '기획서', required: true }),
    document('d2', {
      name: '중간 보고',
      required: false,
      submissionType: 'TEXT',
    }),
  ];
  const rows = [
    row(
      'a',
      [
        {
          documentId: 'd1',
          submitted: true,
          submittedAt: '2026-07-14T00:00:00.000Z',
          file: {
            name: '아주-긴-파일-이름-확인용-기획서-최종본-v3.pdf',
            sizeBytes: 2048,
          },
        },
        {
          documentId: 'd2',
          submitted: true,
          submittedAt: '2026-07-14T01:00:00.000Z',
          file: null,
        },
      ],
      { teamName: '가팀' },
    ),
    row(
      'b',
      [
        { documentId: 'd1', submitted: false, submittedAt: null, file: null },
        { documentId: 'd2', submitted: false, submittedAt: null, file: null },
      ],
      { teamName: '나팀', applicantName: null, memberNicknames: ['nameless'] },
    ),
    // 한 장만 낸 팀. 서류마다 제출 수가 달라야 합계 행이 열을 섞어도 티가 난다.
    row(
      'c',
      [
        {
          documentId: 'd1',
          submitted: true,
          submittedAt: '2026-07-14T02:00:00.000Z',
          file: null,
        },
        { documentId: 'd2', submitted: false, submittedAt: null, file: null },
      ],
      { teamName: '다팀' },
    ),
  ];

  it('필수 서류에만 별표를 붙인다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('기획서<span aria-label="필수"');
    expect(html).not.toContain('중간 보고<span aria-label="필수"');
  });

  it('파일 제출은 파일명을 다운로드 링크로 걸고 전체 이름을 title로 남긴다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain(
      'href="/api/v1/milestones/milestone-1/documents/d1/applications/a/file"',
    );
    expect(html).toContain(
      'title="아주-긴-파일-이름-확인용-기획서-최종본-v3.pdf"',
    );
    expect(html).toContain('truncate');
  });

  it('첨부가 없는 제출은 링크 없이 제출됨으로만 적는다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('제출됨');
    // d2는 TEXT 제출이라 내려받을 것이 없다 — 그 서류로 가는 링크는 없어야 한다.
    expect(html).not.toContain('documents/d2/applications');
  });

  it('미제출 칸과 팀 표기를 그린다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('미제출');
    expect(html).toContain('가팀');
    expect(html).toContain('김철수 외 1명');
    // 신청자 이름이 없으면 GitHub 계정으로 떨어진다(1인 팀이라 「외 N명」은 없다).
    expect(html).toContain('nameless');
  });

  it('첫 열은 가로 스크롤에도 남는다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('sticky left-0 z-10');
  });

  /**
   * 합계는 **서버가 준 `documentTotals`** 그대로다. 화면에 있는 것은 페이지 한 장뿐이라
   * 여기서 세면 「제출 2 / 전체 3」처럼 페이지 크기가 그대로 분모가 된다. 그래서 이
   * 픽스처의 합계는 rows(3팀)에서 절대 파생될 수 없는 값(47팀)으로 둔다 — 클라이언트
   * 계산으로 되돌리면 이 단언이 곧바로 깨진다.
   */
  it('표 아래 합계 행은 서버가 준 전체 기준 합계를 적는다', () => {
    const html = render({
      data: collection(documents, rows, {
        documentTotals: [
          { documentId: 'd1', submitted: 30, total: 47 },
          { documentId: 'd2', submitted: 12, total: 47 },
        ],
      }),
    });

    // 열 순서까지 본다 — 두 수가 화면 어딘가에 있기만 하면 통과하는 단언은 합계가
    // 열을 바꿔 앉아도 그대로 지나간다.
    const footer = html.slice(html.indexOf('<tfoot'));

    expect(footer).toContain('합계');
    expect(footer).toMatch(
      /합계[\s\S]*제출 30 \/ 전체 47[\s\S]*제출 12 \/ 전체 47/,
    );
  });

  it('합계가 빠진 서류도 열을 밀지 않고 0 / 0으로 남는다', () => {
    const html = render({
      data: collection(documents, rows, {
        documentTotals: [{ documentId: 'd2', submitted: 12, total: 47 }],
      }),
    });
    const footer = html.slice(html.indexOf('<tfoot'));

    // d1 자리가 사라져 d2의 합계가 앞으로 당겨 앉으면 안 된다.
    expect(footer).toMatch(
      /합계[\s\S]*제출 0 \/ 전체 0[\s\S]*제출 12 \/ 전체 47/,
    );
  });

  /**
   * 필터 칩의 수도 서버 값(`filterCounts`)이다. 세 값을 서로 다르게, 그리고 페이지
   * 행 수(3)와도 다르게 둬 클라이언트 계산으로 되돌리면 반드시 어긋나게 한다.
   */
  it('빠른 필터 버튼마다 서버가 준 전체 기준 팀 수를 적는다', () => {
    const html = render({
      data: collection(documents, rows, {
        filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
      }),
    });

    expect(html).toContain('전체 47팀');
    expect(html).toContain('필수 서류 미제출 12팀');
    expect(html).toContain('한 장도 안 낸 팀 5팀');
  });

  // 예전 문구는 선택 서류를 안 낸 팀까지 세는 것으로 읽혔다 — 이 필터는 필수 서류만 센다.
  it('필수 기준임이 드러나지 않는 옛 문구를 쓰지 않는다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).not.toContain('미제출 있는 팀');
  });

  /**
   * 필터는 서버가 건다. 화면이 받은 행을 한 번 더 거르면, 서버가 이미 걸러 보낸 페이지를
   * 두 번 거르는 셈이라 필터에 맞는 팀이 조용히 사라진다.
   */
  it('받은 행을 화면에서 다시 거르지 않는다', () => {
    const html = render({
      data: collection(documents, rows, {
        total: 3,
        filterCounts: { all: 3, hasMissing: 3, zeroSubmission: 3 },
      }),
      filter: 'ZERO_SUBMISSION',
    });

    // 「가팀」은 두 장을 다 낸 팀이라 클라이언트 판정으로는 걸러진다. 서버가 보냈으니 그린다.
    expect(html).toContain('가팀');
    expect(html).toContain('나팀');
    expect(html).toContain('다팀');
  });

  it('필터에 아무도 안 걸리면 전체 보기로 되돌릴 길을 준다', () => {
    const html = render({
      data: collection(documents, [], {
        total: 0,
        filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 0 },
      }),
      filter: 'ZERO_SUBMISSION',
    });

    expect(html).toContain('조건에 맞는 팀이 없습니다');
    expect(html).toContain('전체 보기');
    // 신청이 47팀 있는데 「승인된 신청이 없습니다」로 말하면 안 된다.
    expect(html).not.toContain('아직 승인된 신청이 없습니다');
    // 필터 칩은 남는다 — 되돌아갈 곳이 보여야 한다.
    expect(html).toContain('전체 47팀');
  });

  // 「전체 내려받기(ZIP)」는 다음 묶음이다 — 자리도 두지 않는다.
  it('아직 없는 일괄 내려받기 버튼을 미리 만들지 않는다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).not.toContain('ZIP');
    expect(html).not.toContain('전체 내려받기');
  });
});

/**
 * 응답이 페이지 한 장이 되면서 붙은 조작. 모양·문구는 제출 현황 표
 * (`features/submissions/components/submission-matrix-view.tsx`의 `MatrixPagination`)를
 * 그대로 따른다 — 같은 종류의 표를 두 벌의 조작으로 만들지 않는다.
 */
describe('MilestoneDocumentCollectionView 페이지 이동', () => {
  const documents = [document('d1')];
  const rows = [
    row('a', [
      { documentId: 'd1', submitted: false, submittedAt: null, file: null },
    ]),
  ];

  function paged(page: number, total: number): MilestoneDocumentCollection {
    return collection(documents, rows, {
      page,
      pageSize: 20,
      total,
      filterCounts: { all: total, hasMissing: total, zeroSubmission: 0 },
    });
  }

  it('한 페이지에 다 들어가면 이동 UI를 그리지 않는다', () => {
    const html = render({ data: paged(1, 12) });

    expect(html).not.toContain('서류 수합 페이지');
  });

  it('여러 페이지면 이전·다음과 현재 위치를 적는다', () => {
    const html = render({ data: paged(2, 47) });

    expect(html).toContain('aria-label="서류 수합 페이지"');
    expect(html).toContain('이전');
    expect(html).toContain('다음');
    expect(html).toContain('2 / 3');
  });

  it('첫 페이지에서 이전은, 마지막 페이지에서 다음은 잠긴다', () => {
    const first = render({ data: paged(1, 47) });
    const last = render({ data: paged(3, 47) });

    expect(
      first.slice(first.indexOf('이전') - 200, first.indexOf('이전')),
    ).toContain('disabled');
    expect(
      last.slice(last.indexOf('다음') - 200, last.indexOf('다음')),
    ).toContain('disabled');
  });

  // 표에 보이는 것이 전부가 아님을 먼저 말한다 — 페이지 행 수를 전체로 읽으면
  // 「47팀 중 1팀만 냈다」 같은 오독이 생긴다.
  it('이 페이지 행 수와 조건에 맞는 전체 행 수를 함께 적는다', () => {
    const html = render({ data: paged(2, 47) });

    expect(html).toContain('이 페이지 1팀(조건에 맞는 전체 47팀)');
  });

  /**
   * 「필수 서류 미제출」 2페이지를 보는 동안 팀들이 제출을 마치면 걸리는 팀이 줄어
   * 페이지 수도 줄어든다 — 응답은 빈 2페이지 + 전체 1페이지로 온다. 페이지 이동 UI는
   * 한 페이지짜리 결과에서 그리지 않으므로, 여기서 길을 주지 않으면 교직원은 빈 표를
   * 앞에 두고 필터를 손으로 되돌리기 전까지 빠져나갈 수 없다.
   */
  it('결과가 줄어 지금 페이지가 사라지면 되돌아갈 버튼을 준다', () => {
    const html = render({
      data: collection(documents, [], {
        page: 2,
        pageSize: 20,
        total: 5,
        filterCounts: { all: 47, hasMissing: 5, zeroSubmission: 0 },
      }),
      filter: 'HAS_MISSING',
    });

    expect(html).toContain('이 페이지에는 더 이상 팀이 없습니다');
    expect(html).toContain('1페이지로 이동');
    // 필터 칩은 남는다 — 지금 무엇을 보고 있었는지가 사라지면 안 된다.
    expect(html).toContain('필수 서류 미제출 5팀');
    // 빈 표를 그대로 그려 두면 「0팀이 걸렸다」로 읽힌다.
    expect(html).not.toContain('이 페이지 0팀');
  });

  // 30페이지가 29페이지로 줄었을 때 1페이지로 튕기면 보고 있던 자리를 잃는다.
  it('여러 페이지가 남아 있으면 마지막 페이지로 내려앉힌다', () => {
    const html = render({
      data: collection(documents, [], {
        page: 4,
        pageSize: 20,
        total: 47,
        filterCounts: { all: 47, hasMissing: 47, zeroSubmission: 0 },
      }),
    });

    expect(html).toContain('3페이지로 이동');
    expect(html).not.toContain('1페이지로 이동');
  });
});
