import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MilestoneDocumentCollectionView } from './milestone-document-collection-view';
import type { MilestoneDocumentCollectionViewProps } from './milestone-document-collection-view';
import type {
  MilestoneDocumentCollection,
  MilestoneDocumentCollectionCell,
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
    isRequired: true,
    sortOrder: 1,
    ...overrides,
  };
}

/**
 * 낸 칸. 기본은 「아직 아무도 안 본 제출」이다 — 배지는 `status`가 정하고 `review`는
 * 지난 지적일 뿐이라, 둘을 따로 넘길 수 있어야 「다시 낸 칸」을 세울 수 있다.
 */
function cell(
  documentId: string,
  overrides: Partial<MilestoneDocumentCollectionCell> = {},
): MilestoneDocumentCollectionCell {
  return {
    documentId,
    isSubmitted: true,
    status: 'SUBMITTED',
    revision: 1,
    submittedAt: '2026-07-14T00:00:00.000Z',
    file: null,
    content: null,
    review: null,
    ...overrides,
  };
}

/**
 * 그린 순서대로의 배지 문구. 문서 전체를 `toContain`으로 훑으면 「보완 요청」이 판정
 * 버튼·안내 문구에도 있어 배지가 무엇을 말하는지 물을 수 없다.
 */
function badgeTexts(html: string): readonly string[] {
  return [...html.matchAll(/data-slot="status-badge"[^>]*>([^<]*)</g)].map(
    (match) => match[1] ?? '',
  );
}

/** 안 낸 칸 — 상태도 판정도 제출에 붙으므로 둘 다 없다. */
function missingCell(documentId: string): MilestoneDocumentCollectionCell {
  return cell(documentId, {
    isSubmitted: false,
    status: null,
    submittedAt: null,
  });
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
      // `render`가 넘기는 경로 programId와 같은 값 — 화면이 둘을 대조한다.
      programId: 'program-capstone',
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
      loadPhase="idle"
      errorMessage={null}
      review={null}
      reviewNotice={null}
      archiveGrouping="TEAM"
      onArchiveGroupingChange={() => {}}
      onFilterChange={() => {}}
      onPageChange={() => {}}
      onRetry={() => {}}
      onReviewOpen={() => {}}
      onReviewClose={() => {}}
      onReviewDecisionChange={() => {}}
      onReviewCommentChange={() => {}}
      onReviewResubmissionDueAtChange={() => {}}
      onReviewSubmit={() => {}}
      onReviewHistoryMore={() => {}}
      {...overrides}
    />,
  );
}

describe('MilestoneDocumentCollectionView 머리말', () => {
  it('제목에 마일스톤 이름을, 부제에 마감 시각을 적는다', () => {
    const html = render({
      data: collection([document('d1')], [row('a', [missingCell('d1')])]),
    });

    expect(html).toContain('서류 수합 — 기획서 제출');
    expect(html).toContain('2026년 7월 15일');
    expect(html).toContain('마감');
  });
});

describe('MilestoneDocumentCollectionView 빈 상태', () => {
  it('서류 항목이 없으면 프로그램 편집으로 보낸다', () => {
    const html = render({ data: collection([], []) });

    expect(html).toContain('이 마일스톤에는 등록된 제출 항목이 없습니다');
    expect(html).toContain('/programs/program-capstone/edit');
  });

  it('승인된 신청이 없으면 신청 관리로 이어 준다', () => {
    const html = render({ data: collection([document('d1')], []) });

    expect(html).toContain('아직 승인된 신청이 없습니다');
    expect(html).toContain('대기 중인 신청을 먼저 확인해 주세요');
    expect(html).toContain('href="/programs/program-capstone/applicants"');
    expect(html).toContain('신청 확인하기');
    expect(html).not.toContain('등록된 제출 항목이 없습니다');
  });

  /**
   * 조회는 `milestoneId`만 보내므로 프로그램 A의 경로에 B의 마일스톤 id를 끼우면
   * 서버는 B의 표를 순순히 돌려준다. 대조하지 않으면 그 표가 A의 껍데기(좌측 패널·
   * 「프로그램 편집」 링크) 아래에 앉아, 교직원이 B의 팀 목록을 A의 것으로 읽는다.
   */
  it('다른 프로그램의 마일스톤이면 표 대신 찾을 수 없다고 알린다', () => {
    const html = render({
      programId: 'program-capstone',
      data: collection(
        [document('d1', { name: '기획서' })],
        [row('a', [cell('d1')], { teamName: '남의프로그램팀' })],
        {
          milestone: {
            id: 'milestone-9',
            programId: 'program-basic-study',
            name: '남의 마일스톤',
            dueAt: '2026-07-15T14:59:59.000Z',
          },
          total: 47,
          filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
        },
      ),
    });

    expect(html).toContain('찾을 수 없는 마일스톤입니다');
    // 표도 합계도 필터 칩도 없다 — 남는 것이 있으면 그것마저 A의 것으로 읽힌다.
    expect(html).not.toContain('남의프로그램팀');
    expect(html).not.toContain('합계');
    expect(html).not.toContain('전체 47팀');
    // 머리말도 B의 마일스톤 이름을 달지 않는다.
    expect(html).not.toContain('남의 마일스톤');
    expect(html).toContain('href="/programs/program-capstone"');
  });

  // 같은 프로그램의 마일스톤이면 아무 일도 없어야 한다 — 대조가 과하게 걸려 멀쩡한
  // 표까지 막으면 화면이 통째로 쓸모없어진다.
  it('경로와 같은 프로그램의 마일스톤은 그대로 그린다', () => {
    const html = render({
      programId: 'program-capstone',
      data: collection(
        [document('d1', { name: '기획서' })],
        [row('a', [missingCell('d1')], { teamName: '우리팀' })],
      ),
    });

    expect(html).toContain('우리팀');
    expect(html).not.toContain('찾을 수 없는 마일스톤입니다');
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
    document('d1', { name: '기획서', isRequired: true }),
    document('d2', {
      name: '중간 보고',
      isRequired: false,
    }),
  ];
  const rows = [
    row(
      'a',
      [
        cell('d1', {
          file: {
            name: '아주-긴-파일-이름-확인용-기획서-최종본-v3.pdf',
            sizeBytes: 2048,
          },
        }),
        cell('d2', { submittedAt: '2026-07-14T01:00:00.000Z' }),
      ],
      { teamName: '가팀' },
    ),
    row('b', [missingCell('d1'), missingCell('d2')], {
      teamName: '나팀',
      applicantName: null,
      memberNicknames: ['nameless'],
    }),
    // 한 장만 낸 팀. 서류마다 제출 수가 달라야 합계 행이 열을 섞어도 티가 난다.
    row(
      'c',
      [
        cell('d1', { submittedAt: '2026-07-14T02:00:00.000Z' }),
        missingCell('d2'),
      ],
      { teamName: '다팀' },
    ),
  ];

  /**
   * 갱신 중에 뼈대로 갈아 끼우면 여기가 깨진다.
   *
   * 판정 하나를 저장할 때마다 표가 사라졌다 다시 서면 가로 스크롤은 처음으로, 세로
   * 위치는 표 높이를 따라 흔들린다. 여러 건을 연달아 판정하는 교직원은 한 건 처리할
   * 때마다 보던 행과 열을 잃는다 — 패널을 표 안에 둔 이유가 통째로 무너진다.
   */
  it('갱신 중에도 표를 걷지 않는다', () => {
    const html = render({
      data: collection(documents, rows),
      loadPhase: 'refreshing',
    });

    expect(html).toContain('가팀');
    expect(html).toContain('합계');
    expect(html).not.toContain('서류 수합 표를 불러오는 중');
    // 갱신 중임은 말한다 — 눈에 보이는 것을 더하거나 빼지 않으면서.
    expect(html).toContain('aria-busy="true"');
  });

  // 갱신이 끝나면 그 표시도 걷힌다 — 남으면 화면이 영영 「불러오는 중」이라고 말한다.
  it('갱신이 끝나면 표는 더 이상 바쁘다고 말하지 않는다', () => {
    const html = render({
      data: collection(documents, rows),
      loadPhase: 'idle',
    });

    expect(html).toContain('가팀');
    expect(html).not.toContain('aria-busy="true"');
  });

  // 유지할 표가 아직 없는 첫 조회다 — 이때는 뼈대가 맞다.
  it('그릴 표가 없으면 뼈대를 그린다', () => {
    const html = render({ data: null, loadPhase: 'skeleton' });

    expect(html).toContain('서류 수합 표를 불러오는 중');
    expect(html).not.toContain('합계');
  });

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
      'aria-label="가팀 기획서 개별 파일 내려받기: 아주-긴-파일-이름-확인용-기획서-최종본-v3.pdf"',
    );
    expect(html).toContain(
      'aria-describedby="milestone-document-download-behavior-hint"',
    );
    expect(html).toContain(
      'title="아주-긴-파일-이름-확인용-기획서-최종본-v3.pdf"',
    );
    expect(html).toContain('truncate');
  });

  // 배지 문구가 「제출됨」에서 판정 기준 라벨로 바뀌었다(2026-08 서류 판정).
  // 아직 아무도 보지 않은 제출은 「검토 대기」다.
  it('첨부가 없는 제출은 링크 없이 상태 배지만 적는다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('검토 대기');
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
   * 칸 배지는 제출 여부가 아니라 **판정까지 접은 다섯 갈래**를 말한다. 「제출됨」 하나로
   * 뭉치면 이미 반려한 서류와 아직 안 본 서류가 표에서 구분되지 않아, 교직원이 같은 칸을
   * 두 번 열어 본다.
   */
  it('칸 배지가 지금 상태를 그대로 말한다', () => {
    const html = render({
      data: collection(documents, [
        row(
          'a',
          [
            cell('d1', {
              status: 'CHANGES_REQUESTED',
              review: {
                id: 'review-1',
                decision: 'CHANGES_REQUESTED',
                comment: '표지를 고쳐 주세요.',
                reviewedAt: '2026-07-15T00:00:00.000Z',
                resubmissionDueAt: null,
              },
            }),
            cell('d2', {
              status: 'APPROVED',
              submittedAt: '2026-07-14T01:00:00.000Z',
              review: {
                id: 'review-2',
                decision: 'APPROVED',
                comment: null,
                reviewedAt: '2026-07-15T00:00:00.000Z',
                resubmissionDueAt: null,
              },
            }),
          ],
          { teamName: '가팀' },
        ),
      ]),
    });

    expect(html).toContain('보완 요청');
    expect(html).toContain('승인');
    // 사유는 표에 펴 놓지 않는다 — 칸이 좁아 표가 읽히지 않게 된다.
    expect(html).not.toContain('표지를 고쳐 주세요.');
  });

  /**
   * 보완 요청에 응해 **다시 낸** 칸. 서버는 제출 상태만 `SUBMITTED`로 되돌리고 판정
   * 기록은 그대로 두므로, 배지를 `review.decision`으로 정하면 이 칸이 계속 「보완 요청」
   * 으로 남는다 — 교직원은 다시 검토해야 할 건을 이미 처리한 것으로 읽고 지나간다.
   */
  it('다시 낸 칸은 지난 보완 요청이 남아 있어도 검토 대기로 돌아온다', () => {
    const html = render({
      data: collection(documents, [
        row(
          'a',
          [
            cell('d1', {
              status: 'SUBMITTED',
              submittedAt: '2026-07-20T00:00:00.000Z',
              review: {
                id: 'review-3',
                decision: 'CHANGES_REQUESTED',
                comment: '표지를 고쳐 주세요.',
                reviewedAt: '2026-07-15T00:00:00.000Z',
                resubmissionDueAt: null,
              },
            }),
            missingCell('d2'),
          ],
          { teamName: '가팀' },
        ),
      ]),
    });

    // 이 표의 배지는 「검토 대기」와 「미제출」 둘뿐이다 — 보완 요청이 남아 있으면 걸린다.
    expect(badgeTexts(html)).toEqual(['검토 대기', '미제출']);
  });

  /**
   * ⚠ 판정은 **표시값이지 업무 규칙이 아니다**. 반려·보완 요청이 붙어도 필터 칩과 합계
   * 행은 그대로여야 한다 — 그 셈은 서버가 하고, 「미제출」 기준은 여전히 「제출 행이 없다」다.
   * 반려된 칸을 미제출로 세기 시작하면 독촉 대상 집계가 조용히 뜻을 바꾼다.
   */
  it('판정이 붙어도 필터 칩과 합계는 서버가 준 값 그대로다', () => {
    const withReviews = collection(documents, rows, {
      filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
      documentTotals: [
        { documentId: 'd1', submitted: 30, total: 47 },
        { documentId: 'd2', submitted: 12, total: 47 },
      ],
    });
    const reviewed: MilestoneDocumentCollection = {
      ...withReviews,
      rows: withReviews.rows.map((item) => ({
        ...item,
        cells: item.cells.map((current) =>
          current.isSubmitted
            ? {
                ...current,
                review: {
                  id: 'review-4',
                  decision: 'REJECTED' as const,
                  comment: '기한을 넘겼습니다.',
                  reviewedAt: '2026-07-15T00:00:00.000Z',
                  resubmissionDueAt: null,
                },
              }
            : current,
        ),
      })),
    };

    const html = render({ data: reviewed });

    expect(html).toContain('전체 47팀');
    expect(html).toContain('필수 서류 미제출 12팀');
    expect(html).toContain('한 장도 안 낸 팀 5팀');
    expect(html).toContain('제출 30 / 전체 47');
    expect(html).toContain('제출 12 / 전체 47');
  });

  // 판정할 제출이 없는 칸을 눌러 봐야 서버는 404(MSD_022)만 돌려준다.
  it('제출된 칸에만 판정을 여는 버튼을 단다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('aria-label="가팀 기획서 검토"');
    expect(html).not.toContain('aria-label="나팀 기획서 검토"');
  });

  it('모바일 판정 패널은 넓은 표가 아니라 현재 화면 폭 안에 머문다', () => {
    const html = render({
      data: collection(documents, rows),
      review: {
        target: { applicationId: 'a', documentId: 'd1' },
        version: { expectedRevision: 1, expectedLatestReviewId: null },
        decision: null,
        comment: '',
        resubmissionDueAt: '',
        isSubmitting: false,
        errorMessage: null,
        history: [],
        historyNextCursor: null,
        historyIsComplete: true,
        isHistoryLoading: false,
        historyError: null,
      },
    });

    expect(html).toContain(
      'data-testid="milestone-document-review-panel-viewport"',
    );
    expect(html).toContain('sticky left-0 w-[calc(100vw-4rem)]');
    expect(html).toContain('whitespace-normal');
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
});

/**
 * 전체 제출물 ZIP. 링크 하나와 폴더 구조 토글 하나뿐이지만, 이 화면에서 **혼자만 표를
 * 따라가지 않는** 조작이라 그 사실이 화면에 남아 있는지까지 본다.
 */
describe('MilestoneDocumentCollectionView 전체 내려받기(ZIP)', () => {
  const documents = [document('d1', { name: '기획서' })];
  const rows = [row('a', [missingCell('d1')], { teamName: '가팀' })];

  const TEAM_HREF =
    'href="/api/v1/milestones/milestone-1/documents/collection/archive?groupBy=TEAM"';
  const DOCUMENT_HREF =
    'href="/api/v1/milestones/milestone-1/documents/collection/archive?groupBy=DOCUMENT"';

  it('기본은 팀 기준으로 묶은 ZIP 링크를 건다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('마일스톤 전체 내려받기(ZIP)');
    expect(html).toContain(TEAM_HREF);
    /*
     * ⚠ `download` 속성이 **없어야** 한다. 붙으면 브라우저가 응답 본문을 상태 코드와
     * 무관하게 파일로 저장해, 401·403·404·413이 나도 교직원은 오류 대신 **오류 JSON이
     * 담긴 파일**을 받는다. 성공 응답은 서버의 `Content-Disposition: attachment`가
     * 그대로 내려받게 하므로 속성 없이도 정상 동선은 똑같다.
     */
    const [archiveLink] = /<a[^>]*archive\?groupBy=TEAM[^>]*>/.exec(html) ?? [];
    expect(archiveLink).toBeDefined();
    expect(archiveLink).not.toMatch(/\sdownload(?:[=\s>])/);
  });

  /**
   * 토글은 **링크의 href만** 바꾼다. 두 href가 한 화면에 함께 있으면 안 된다 —
   * 켠 사람은 「서류 종류별」을 눌렀다고 믿는데 팀 기준 ZIP이 떨어질 수 있다.
   */
  it('서류 종류별로 묶기를 켜면 같은 링크가 DOCUMENT로 바뀐다', () => {
    const off = render({ data: collection(documents, rows) });
    const on = render({
      data: collection(documents, rows),
      archiveGrouping: 'DOCUMENT',
    });

    expect(off).toContain(TEAM_HREF);
    expect(off).not.toContain(DOCUMENT_HREF);
    expect(on).toContain(DOCUMENT_HREF);
    expect(on).not.toContain(TEAM_HREF);
  });

  it('토글은 지금 구조를 체크 상태로 말하고 라벨과 묶인다', () => {
    const off = render({ data: collection(documents, rows) });
    const on = render({
      data: collection(documents, rows),
      archiveGrouping: 'DOCUMENT',
    });

    // 라벨이 입력과 묶여 있어야 스크린리더가 「무엇을 켜는가」를 읽는다.
    expect(on).toContain('id="milestone-document-collection-archive-grouping"');
    expect(on).toContain(
      'for="milestone-document-collection-archive-grouping"',
    );
    expect(on).toContain('서류 종류별로 묶기');
    expect(on).toContain('checked');
    expect(off).not.toContain('checked');
  });

  /**
   * ⚠ 이 한 줄이 이 묶음의 핵심이다. 「필수 서류 미제출」로 걸러 놓은 교직원은 눈앞의
   * 표가 곧 받을 것이라고 읽으므로, 밝히지 않으면 전체가 담긴 ZIP을 독촉 대상 명단으로
   * 오해한 채 배포한다.
   */
  it('ZIP이 필터·페이지와 무관하게 전체 팀을 담음을 밝힌다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain(
      '빠른 필터·페이지와 무관하게 이 마일스톤의 전체 팀을 담습니다.',
    );
    // 링크가 그 문단을 가리켜, 버튼만 읽고 지나가는 사람에게도 함께 읽힌다.
    expect(html).toContain(
      'aria-describedby="milestone-document-collection-archive-hint milestone-document-download-behavior-hint"',
    );
    // 표 위 안내문과 다른 문단이다 — 한 문단에 섞이면 정반대의 두 사실이 뭉개진다.
    expect(html).toContain('id="milestone-document-collection-scroll-hint"');
  });

  it('진행·완료와 오류가 브라우저에서 어떻게 보이는지 밝힌다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain(
      '진행 상태와 완료 여부는 브라우저에서 확인합니다. 요청이 실패하면 오류 응답을 파일로 저장하지 않고 안내 화면을 엽니다.',
    );
    expect(html).toContain('id="milestone-document-download-behavior-hint"');
  });

  /**
   * 표가 아예 서지 않는 세 빈 상태 — 담을 제출물이 없다. 눌러 봐야 빈 ZIP이거나
   * (`wrong-program`) 남의 프로그램 것이라, 자리를 두지 않는다.
   */
  it('표를 그리지 않는 빈 상태에서는 ZIP 조작도 그리지 않는다', () => {
    const noDocuments = render({ data: collection([], []) });
    const noApplications = render({ data: collection(documents, []) });
    const wrongProgram = render({
      programId: 'program-capstone',
      data: collection(documents, rows, {
        milestone: {
          id: 'milestone-9',
          programId: 'program-basic-study',
          name: '남의 마일스톤',
          dueAt: '2026-07-15T14:59:59.000Z',
        },
        total: 47,
        filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
      }),
    });

    // ZIP 쪽을 먼저 묻는다 — 빈 상태 문구를 앞에 두면 그쪽이 먼저 깨지면서 「ZIP이
    // 남았는가」는 물어보지도 못한 채 통과·실패가 갈린다.
    expect(noDocuments).not.toContain('전체 내려받기');
    expect(noApplications).not.toContain('전체 내려받기');
    expect(wrongProgram).not.toContain('전체 내려받기');
    // 남의 마일스톤 id로 가는 경로가 남으면 그것만으로 남의 제출물을 받는 길이 된다.
    expect(wrongProgram).not.toContain('milestone-9');
    // 셋이 정말 그 빈 상태였는지도 확인한다 — 아니면 위 단언은 아무것도 묻지 않는다.
    expect(noDocuments).toContain('등록된 제출 항목이 없습니다');
    expect(noApplications).toContain('아직 승인된 신청이 없습니다');
    expect(wrongProgram).toContain('찾을 수 없는 마일스톤입니다');
  });

  /**
   * 반대로 **필터 결과만 비고 표 자체는 있는** 두 경우에는 남긴다. ZIP은 필터를 따라가지
   * 않으므로 여전히 온전하고, 오히려 「지금 조건에는 아무도 없다」를 본 사람이 전체를
   * 받아 보려는 자리다.
   */
  it('필터에 아무도 안 걸려도 ZIP 조작은 남는다', () => {
    const html = render({
      data: collection(documents, [], {
        total: 0,
        filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 0 },
      }),
      filter: 'ZERO_SUBMISSION',
    });

    expect(html).toContain('조건에 맞는 팀이 없습니다');
    expect(html).toContain('전체 내려받기(ZIP)');
    expect(html).toContain(TEAM_HREF);
  });

  it('지금 페이지가 사라진 경우에도 ZIP 조작은 남는다', () => {
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
    expect(html).toContain('전체 내려받기(ZIP)');
  });

  /**
   * 좁은 화면에서 필터 칩 줄과 ZIP 조작이 한 줄에 붙들려 있으면, 표가 아니라 조작 줄
   * 때문에 화면 전체가 좌우로 흔들린다(320px QA).
   */
  it('좁은 화면에서는 필터 칩 줄과 ZIP 조작이 세로로 쌓인다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('flex min-w-0 flex-col gap-4 sm:flex-row');
    expect(html).toContain(
      '<span class="whitespace-nowrap">스크롤해 확인하세요.</span>',
    );
  });
});

/**
 * 서류 한 종류만 받는 ZIP — 열 머리글마다 하나씩. 「사업계획서만 전 팀 것을 모아
 * 심사위원에게」가 실제 동선이고, 그 전에는 47팀의 칸을 하나씩 눌러야 했다.
 */
describe('MilestoneDocumentCollectionView 서류별 내려받기(ZIP)', () => {
  const documents = [
    document('d1', { name: '기획서' }),
    document('d2', { name: '사업계획서', isRequired: false }),
  ];
  const rows = [row('a', [missingCell('d1'), missingCell('d2')])];

  function occurrences(html: string, needle: string): number {
    return html.split(needle).length - 1;
  }

  it('서류마다 그 서류만 담는 링크를 하나씩 건다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(
      occurrences(
        html,
        'href="/api/v1/milestones/milestone-1/documents/collection/archive?documentId=d1"',
      ),
    ).toBe(1);
    expect(
      occurrences(
        html,
        'href="/api/v1/milestones/milestone-1/documents/collection/archive?documentId=d2"',
      ),
    ).toBe(1);
  });

  /**
   * ⚠ `documentId`와 `groupBy`를 **함께 보내면 서버가 400**으로 막는다. 전체 ZIP 링크는
   * 정반대로 `groupBy`를 언제나 싣기 때문에, 한 화면에 둘이 나란히 있는 이 자리에서
   * 실수로 옮겨 붙기 쉽다 — 그러면 열 머리글의 버튼이 전부 오류만 낸다.
   */
  it('서류별 링크에는 groupBy가 붙지 않는다', () => {
    const html = render({ data: collection(documents, rows) });

    for (const href of [
      ...html.matchAll(/href="([^"]*collection\/archive[^"]*)"/g),
    ]
      .map((match) => match[1] ?? '')
      .filter((href) => href.includes('documentId='))) {
      expect(href).not.toContain('groupBy');
    }
    // 위 반복이 정말 링크를 훑었는지 — 0건이면 아무것도 묻지 않은 채 통과한다.
    expect(html).toContain('archive?documentId=d1');
  });

  /**
   * ⚠ 아이콘만 있는 버튼이라 `aria-label`이 유일한 이름이고, **어느 서류인지**가
   * 그 안에 있어야 한다. 열이 여러 개라 「내려받기」만 있으면 스크린리더에는 같은 이름의
   * 버튼이 열 수만큼 늘어서 무엇을 고르는지 알 수 없다.
   */
  it('aria-label에 서류 이름과 서류별 ZIP임이 함께 들어간다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('aria-label="기획서 서류별 내려받기(ZIP)"');
    expect(html).toContain('aria-label="사업계획서 서류별 내려받기(ZIP)"');
  });

  /**
   * ⚠ `download` 속성이 **없어야** 한다 — 전체 ZIP 링크와 같은 이유다. 붙으면 브라우저가
   * 응답 본문을 상태 코드와 무관하게 파일로 저장해, 401·403·404가 나도 교직원은 오류
   * 대신 오류 JSON이 담긴 파일을 받고 무엇이 잘못됐는지 영영 모른다.
   */
  it('download 속성을 쓰지 않는다', () => {
    const html = render({ data: collection(documents, rows) });
    const [linkTag] = /<a[^>]*archive\?documentId=d1[^>]*>/.exec(html) ?? [];

    expect(linkTag).toBeDefined();
    expect(linkTag).not.toMatch(/\sdownload(?:[=\s>])/);
    // 표와 열 머리글이 정말 그려졌는지 — 아니면 위 단언은 아무것도 묻지 않는다.
    expect(html).toContain('archive?documentId=d1');
  });

  /**
   * 호버로 나타내지 않는다. 호버로만 보이면 키보드·터치 사용자에게는 없는 기능이 된다 —
   * 이 저장소의 접근성 QA가 반복해 지적한 자리다.
   */
  it('호버해야 보이는 버튼이 아니다', () => {
    const html = render({ data: collection(documents, rows) });
    const [linkTag] = /<a[^>]*archive\?documentId=d1[^>]*>/.exec(html) ?? [];

    expect(linkTag).toBeDefined();
    // `hover:text-foreground`처럼 색만 바뀌는 것은 괜찮고, 보임 자체를 호버에 거는 것은 안 된다.
    expect(linkTag).not.toMatch(/(group-)?hover:(opacity|flex|inline|block)/);
    expect(linkTag).not.toContain('opacity-0');
    expect(linkTag).not.toContain('sr-only');
  });

  /** 설명은 전체 ZIP과 같은 문단을 가리킨다 — 이 ZIP도 필터·페이지를 따라가지 않는다. */
  it('전체 팀을 담는다는 같은 안내 문단을 가리킨다', () => {
    const html = render({ data: collection(documents, rows) });
    const [linkTag] = /<a[^>]*archive\?documentId=d1[^>]*>/.exec(html) ?? [];

    expect(linkTag).toContain(
      'aria-describedby="milestone-document-collection-archive-hint milestone-document-download-behavior-hint"',
    );
    expect(html).toContain(
      '빠른 필터·페이지와 무관하게 이 마일스톤의 전체 팀을 담습니다.',
    );
  });

  /** 표가 서지 않으면 열 머리글도 없다 — 받을 것이 없는데 길만 남으면 안 된다. */
  it('표를 그리지 않는 빈 상태에서는 나오지 않는다', () => {
    const noDocuments = render({ data: collection([], []) });
    const noApplications = render({ data: collection(documents, []) });
    const noFilterResults = render({
      data: collection(documents, [], {
        total: 0,
        filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 0 },
      }),
      filter: 'ZERO_SUBMISSION',
    });

    expect(noDocuments).not.toContain('documentId=');
    expect(noApplications).not.toContain('documentId=');
    expect(noFilterResults).not.toContain('documentId=');
    // 셋이 정말 그 빈 상태였는지도 확인한다.
    expect(noDocuments).toContain('등록된 제출 항목이 없습니다');
    expect(noApplications).toContain('아직 승인된 신청이 없습니다');
    expect(noFilterResults).toContain('조건에 맞는 팀이 없습니다');
  });

  /** 남의 프로그램 마일스톤이면 그 id로 가는 길이 하나도 남으면 안 된다. */
  it('다른 프로그램의 마일스톤이면 서류별 링크도 남기지 않는다', () => {
    const html = render({
      programId: 'program-capstone',
      data: collection(documents, rows, {
        milestone: {
          id: 'milestone-9',
          programId: 'program-basic-study',
          name: '남의 마일스톤',
          dueAt: '2026-07-15T14:59:59.000Z',
        },
        total: 47,
        filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
      }),
    });

    expect(html).not.toContain('documentId=');
    expect(html).not.toContain('milestone-9');
    expect(html).toContain('찾을 수 없는 마일스톤입니다');
  });

  // 필수 표시(*)와 나란히 서도 서류명이 그대로 읽혀야 한다 — 머리글이 한 덩어리로 뭉치면
  // 「기획서*」가 아니라 「기획서*기획서 전체 내려받기」처럼 붙어 읽힌다.
  it('필수 표시와 서류명을 그대로 두고 옆에 붙는다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('기획서');
    expect(html).toContain('aria-label="필수"');
  });
});

/**
 * 응답이 페이지 한 장이 되면서 붙은 조작. 모양·문구는 제출 현황 표
 * (`features/submissions/components/submission-matrix-view.tsx`의 `MatrixPagination`)를
 * 그대로 따른다 — 같은 종류의 표를 두 벌의 조작으로 만들지 않는다.
 */
describe('MilestoneDocumentCollectionView 페이지 이동', () => {
  const documents = [document('d1')];
  const rows = [row('a', [missingCell('d1')])];

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
