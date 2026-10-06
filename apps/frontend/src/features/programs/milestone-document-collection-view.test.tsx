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

function badgeTexts(html: string): readonly string[] {
  return [...html.matchAll(/data-slot="status-badge"[^>]*>([^<]*)</g)].map(
    (match) => match[1] ?? '',
  );
}

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
    deliveryStatus: 'MISSING',
    teamName: `${applicationId}팀`,
    applicantName: '김철수',
    memberNicknames: ['chulsoo', 'younghee'],
    cells,
    ...overrides,
  };
}

function collection(
  documents: readonly MilestoneDocumentCollectionDocument[],
  rows: readonly MilestoneDocumentCollectionRow[],
  overrides: Partial<MilestoneDocumentCollection> = {},
): MilestoneDocumentCollection {
  return {
    milestone: {
      id: 'milestone-1',

      programId: 'program-capstone',
      name: '기획서 제출',
      dueAt: '2026-07-15T14:59:59.000Z',
    },
    documents,
    rows,
    page: 1,
    pageSize: 20,
    total: rows.length,
    deliveryCounts: { missing: 12, late: 10, complete: 20, noRequiredItems: 5 },
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
    expect(html).toContain('href="/programs/program-capstone/teams"');
    expect(html).toContain('신청 확인하기');
    expect(html).not.toContain('등록된 제출 항목이 없습니다');
  });

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
          deliveryCounts: {
            missing: 12,
            late: 10,
            complete: 20,
            noRequiredItems: 5,
          },
          filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
        },
      ),
    });

    expect(html).toContain('찾을 수 없는 마일스톤입니다');

    expect(html).not.toContain('남의프로그램팀');
    expect(html).not.toContain('합계');
    expect(html).not.toContain('전체 47팀');

    expect(html).not.toContain('남의 마일스톤');
    expect(html).toContain('href="/programs/program-capstone"');
  });

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

    row(
      'c',
      [
        cell('d1', { submittedAt: '2026-07-14T02:00:00.000Z' }),
        missingCell('d2'),
      ],
      { teamName: '다팀' },
    ),
  ];

  it('갱신 중에도 표를 걷지 않는다', () => {
    const html = render({
      data: collection(documents, rows),
      loadPhase: 'refreshing',
    });

    expect(html).toContain('가팀');
    expect(html).toContain('합계');
    expect(html).not.toContain('서류 수합 표를 불러오는 중');

    expect(html).toContain('aria-busy="true"');
  });

  it('갱신이 끝나면 표는 더 이상 바쁘다고 말하지 않는다', () => {
    const html = render({
      data: collection(documents, rows),
      loadPhase: 'idle',
    });

    expect(html).toContain('가팀');
    expect(html).not.toContain('aria-busy="true"');
  });

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

  it('첨부가 없는 제출은 링크 없이 상태 배지만 적는다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('검토 대기');

    expect(html).not.toContain('documents/d2/applications');
  });

  it('미제출 칸과 팀 표기를 그린다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('미제출');
    expect(html).toContain('가팀');
    expect(html).toContain('김철수 외 1명');

    expect(html).toContain('nameless');
  });

  it('첫 열은 가로 스크롤에도 남는다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('sticky left-0 z-10');
  });

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

    expect(html).not.toContain('표지를 고쳐 주세요.');
  });

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

    expect(badgeTexts(html)).toEqual(['미제출 있음', '검토 대기', '미제출']);
  });

  it('판정이 붙어도 필터 칩과 합계는 서버가 준 값 그대로다', () => {
    const withReviews = collection(documents, rows, {
      deliveryCounts: {
        missing: 12,
        late: 10,
        complete: 20,
        noRequiredItems: 5,
      },
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
    expect(html).toContain('미제출 있음 12팀');
    expect(html).toContain('한 장도 안 낸 팀 5팀');
    expect(html).toContain('제출 30 / 전체 47');
    expect(html).toContain('제출 12 / 전체 47');
  });

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

  it('표 아래 합계 행은 서버가 준 전체 기준 합계를 적는다', () => {
    const html = render({
      data: collection(documents, rows, {
        documentTotals: [
          { documentId: 'd1', submitted: 30, total: 47 },
          { documentId: 'd2', submitted: 12, total: 47 },
        ],
      }),
    });

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

    expect(footer).toMatch(
      /합계[\s\S]*제출 0 \/ 전체 0[\s\S]*제출 12 \/ 전체 47/,
    );
  });

  it('빠른 필터 버튼마다 서버가 준 전체 기준 팀 수를 적는다', () => {
    const html = render({
      data: collection(documents, rows, {
        deliveryCounts: {
          missing: 12,
          late: 10,
          complete: 20,
          noRequiredItems: 5,
        },
        filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
      }),
    });

    expect(html).toContain('전체 47팀');
    expect(html).toContain('미제출 있음 12팀');
    expect(html).toContain('한 장도 안 낸 팀 5팀');
  });

  it('필수 기준임이 드러나지 않는 옛 문구를 쓰지 않는다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).not.toContain('미제출 있는 팀');
  });

  it('받은 행을 화면에서 다시 거르지 않는다', () => {
    const html = render({
      data: collection(documents, rows, {
        total: 3,
        deliveryCounts: {
          missing: 12,
          late: 10,
          complete: 20,
          noRequiredItems: 5,
        },
        filterCounts: { all: 3, hasMissing: 3, zeroSubmission: 3 },
      }),
      filter: 'ZERO_SUBMISSION',
    });

    expect(html).toContain('가팀');
    expect(html).toContain('나팀');
    expect(html).toContain('다팀');
  });

  it('필터에 아무도 안 걸리면 전체 보기로 되돌릴 길을 준다', () => {
    const html = render({
      data: collection(documents, [], {
        total: 0,
        deliveryCounts: {
          missing: 12,
          late: 10,
          complete: 20,
          noRequiredItems: 5,
        },
        filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 0 },
      }),
      filter: 'ZERO_SUBMISSION',
    });

    expect(html).toContain('조건에 맞는 팀이 없습니다');
    expect(html).toContain('전체 보기');

    expect(html).not.toContain('아직 승인된 신청이 없습니다');

    expect(html).toContain('전체 47팀');
  });
});

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

    const [archiveLink] = /<a[^>]*archive\?groupBy=TEAM[^>]*>/.exec(html) ?? [];
    expect(archiveLink).toBeDefined();
    expect(archiveLink).not.toMatch(/\sdownload(?:[=\s>])/);
  });

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

    expect(on).toContain('id="milestone-document-collection-archive-grouping"');
    expect(on).toContain(
      'for="milestone-document-collection-archive-grouping"',
    );
    expect(on).toContain('서류 종류별로 묶기');
    expect(on).toContain('checked');
    expect(off).not.toContain('checked');
  });

  it('ZIP이 필터·페이지와 무관하게 전체 팀을 담음을 밝힌다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain(
      '빠른 필터·페이지와 무관하게 이 마일스톤의 전체 팀을 담습니다.',
    );

    expect(html).toContain(
      'aria-describedby="milestone-document-collection-archive-hint milestone-document-download-behavior-hint"',
    );

    expect(html).toContain('id="milestone-document-collection-scroll-hint"');
  });

  it('진행·완료와 오류가 브라우저에서 어떻게 보이는지 밝힌다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain(
      '다운로드 진행 상태는 브라우저에서 확인하세요. 실패하면 안내 화면이 열립니다.',
    );
    expect(html).toContain('id="milestone-document-download-behavior-hint"');
  });

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
        deliveryCounts: {
          missing: 12,
          late: 10,
          complete: 20,
          noRequiredItems: 5,
        },
        filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
      }),
    });

    expect(noDocuments).not.toContain('전체 내려받기');
    expect(noApplications).not.toContain('전체 내려받기');
    expect(wrongProgram).not.toContain('전체 내려받기');

    expect(wrongProgram).not.toContain('milestone-9');

    expect(noDocuments).toContain('등록된 제출 항목이 없습니다');
    expect(noApplications).toContain('아직 승인된 신청이 없습니다');
    expect(wrongProgram).toContain('찾을 수 없는 마일스톤입니다');
  });

  it('필터에 아무도 안 걸려도 ZIP 조작은 남는다', () => {
    const html = render({
      data: collection(documents, [], {
        total: 0,
        deliveryCounts: {
          missing: 12,
          late: 10,
          complete: 20,
          noRequiredItems: 5,
        },
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
        deliveryCounts: {
          missing: 5,
          late: 10,
          complete: 27,
          noRequiredItems: 5,
        },
        filterCounts: { all: 47, hasMissing: 5, zeroSubmission: 0 },
      }),
      filter: 'HAS_MISSING',
    });

    expect(html).toContain('이 페이지에는 더 이상 팀이 없습니다');
    expect(html).toContain('전체 내려받기(ZIP)');
  });

  it('좁은 화면에서는 필터 칩 줄과 ZIP 조작이 세로로 쌓인다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('flex min-w-0 flex-col gap-4 sm:flex-row');
    expect(html).toContain(
      '<span class="whitespace-nowrap">스크롤해 확인하세요.</span>',
    );
  });
});

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

  it('서류별 링크에는 groupBy가 붙지 않는다', () => {
    const html = render({ data: collection(documents, rows) });

    for (const href of [
      ...html.matchAll(/href="([^"]*collection\/archive[^"]*)"/g),
    ]
      .map((match) => match[1] ?? '')
      .filter((href) => href.includes('documentId='))) {
      expect(href).not.toContain('groupBy');
    }

    expect(html).toContain('archive?documentId=d1');
  });

  it('aria-label에 서류 이름과 서류별 ZIP임이 함께 들어간다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('aria-label="기획서 서류별 내려받기(ZIP)"');
    expect(html).toContain('aria-label="사업계획서 서류별 내려받기(ZIP)"');
  });

  it('download 속성을 쓰지 않는다', () => {
    const html = render({ data: collection(documents, rows) });
    const [linkTag] = /<a[^>]*archive\?documentId=d1[^>]*>/.exec(html) ?? [];

    expect(linkTag).toBeDefined();
    expect(linkTag).not.toMatch(/\sdownload(?:[=\s>])/);

    expect(html).toContain('archive?documentId=d1');
  });

  it('호버해야 보이는 버튼이 아니다', () => {
    const html = render({ data: collection(documents, rows) });
    const [linkTag] = /<a[^>]*archive\?documentId=d1[^>]*>/.exec(html) ?? [];

    expect(linkTag).toBeDefined();

    expect(linkTag).not.toMatch(/(group-)?hover:(opacity|flex|inline|block)/);
    expect(linkTag).not.toContain('opacity-0');
    expect(linkTag).not.toContain('sr-only');
  });

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

  it('표를 그리지 않는 빈 상태에서는 나오지 않는다', () => {
    const noDocuments = render({ data: collection([], []) });
    const noApplications = render({ data: collection(documents, []) });
    const noFilterResults = render({
      data: collection(documents, [], {
        total: 0,
        deliveryCounts: {
          missing: 12,
          late: 10,
          complete: 20,
          noRequiredItems: 5,
        },
        filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 0 },
      }),
      filter: 'ZERO_SUBMISSION',
    });

    expect(noDocuments).not.toContain('documentId=');
    expect(noApplications).not.toContain('documentId=');
    expect(noFilterResults).not.toContain('documentId=');

    expect(noDocuments).toContain('등록된 제출 항목이 없습니다');
    expect(noApplications).toContain('아직 승인된 신청이 없습니다');
    expect(noFilterResults).toContain('조건에 맞는 팀이 없습니다');
  });

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
        deliveryCounts: {
          missing: 12,
          late: 10,
          complete: 20,
          noRequiredItems: 5,
        },
        filterCounts: { all: 47, hasMissing: 12, zeroSubmission: 5 },
      }),
    });

    expect(html).not.toContain('documentId=');
    expect(html).not.toContain('milestone-9');
    expect(html).toContain('찾을 수 없는 마일스톤입니다');
  });

  it('필수 표시와 서류명을 그대로 두고 옆에 붙는다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('기획서');
    expect(html).toContain('aria-label="필수"');
  });
});

describe('MilestoneDocumentCollectionView 페이지 이동', () => {
  const documents = [document('d1')];
  const rows = [row('a', [missingCell('d1')])];

  function paged(page: number, total: number): MilestoneDocumentCollection {
    return collection(documents, rows, {
      page,
      pageSize: 20,
      total,
      deliveryCounts: {
        missing: 12,
        late: 10,
        complete: 20,
        noRequiredItems: 5,
      },
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

  it('이 페이지 행 수와 조건에 맞는 전체 행 수를 함께 적는다', () => {
    const html = render({ data: paged(2, 47) });

    expect(html).toContain('이 페이지 1팀(조건에 맞는 전체 47팀)');
  });

  it('결과가 줄어 지금 페이지가 사라지면 되돌아갈 버튼을 준다', () => {
    const html = render({
      data: collection(documents, [], {
        page: 2,
        pageSize: 20,
        total: 5,
        deliveryCounts: {
          missing: 5,
          late: 10,
          complete: 20,
          noRequiredItems: 5,
        },
        filterCounts: { all: 47, hasMissing: 5, zeroSubmission: 0 },
      }),
      filter: 'HAS_MISSING',
    });

    expect(html).toContain('이 페이지에는 더 이상 팀이 없습니다');
    expect(html).toContain('1페이지로 이동');

    expect(html).toContain('미제출 있음 5팀');

    expect(html).not.toContain('이 페이지 0팀');
  });

  it('여러 페이지가 남아 있으면 마지막 페이지로 내려앉힌다', () => {
    const html = render({
      data: collection(documents, [], {
        page: 4,
        pageSize: 20,
        total: 47,
        deliveryCounts: {
          missing: 12,
          late: 10,
          complete: 20,
          noRequiredItems: 5,
        },
        filterCounts: { all: 47, hasMissing: 47, zeroSubmission: 0 },
      }),
    });

    expect(html).toContain('3페이지로 이동');
    expect(html).not.toContain('1페이지로 이동');
  });
});

it('필수 서류를 모두 낸 팀의 반려 결과를 제출 완료와 구분한다', () => {
  const html = render({
    data: collection(
      [document('d1')],
      [
        row('a', [cell('d1', { status: 'REJECTED' })], {
          deliveryStatus: 'COMPLETE',
        }),
      ],
    ),
  });
  expect(html).toContain('>필수 서류 제출 상태</p>');
  expect(badgeTexts(html)).toEqual(['제출 완료', '반려']);
});
