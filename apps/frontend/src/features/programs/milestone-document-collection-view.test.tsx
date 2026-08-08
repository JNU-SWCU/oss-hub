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

function collection(
  documents: readonly MilestoneDocumentCollectionDocument[],
  rows: readonly MilestoneDocumentCollectionRow[],
): MilestoneDocumentCollection {
  return {
    milestone: {
      id: 'milestone-1',
      name: '기획서 제출',
      dueAt: '2026-07-15T14:59:59.000Z',
    },
    documents,
    rows,
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

  it('표 아래 합계 행에 서류별 제출 수와 전체 팀 수를 적는다', () => {
    const html = render({ data: collection(documents, rows) });

    // 열 순서까지 본다 — 두 수가 화면 어딘가에 있기만 하면 통과하는 단언은 합계가
    // 열을 바꿔 앉아도 그대로 지나간다.
    const footer = html.slice(html.indexOf('<tfoot'));

    expect(footer).toContain('합계');
    expect(footer).toMatch(
      /합계[\s\S]*제출 2 \/ 전체 3[\s\S]*제출 1 \/ 전체 3/,
    );
  });

  it('빠른 필터 버튼마다 해당 팀 수를 함께 적는다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).toContain('전체 3팀');
    expect(html).toContain('미제출 있는 팀 2팀');
    expect(html).toContain('한 장도 안 낸 팀 1팀');
  });

  it('필터가 걸리면 남은 팀만 그린다', () => {
    const html = render({
      data: collection(documents, rows),
      filter: 'ZERO_SUBMISSION',
    });

    expect(html).toContain('나팀');
    expect(html).not.toContain('>가팀<');
  });

  it('필터 결과가 비면 전체 보기로 되돌릴 길을 준다', () => {
    const html = render({
      data: collection(documents, [rows[0] as MilestoneDocumentCollectionRow]),
      filter: 'ZERO_SUBMISSION',
    });

    expect(html).toContain('조건에 맞는 팀이 없습니다');
    expect(html).toContain('전체 보기');
  });

  // 「전체 내려받기(ZIP)」는 다음 묶음이다 — 자리도 두지 않는다.
  it('아직 없는 일괄 내려받기 버튼을 미리 만들지 않는다', () => {
    const html = render({ data: collection(documents, rows) });

    expect(html).not.toContain('ZIP');
    expect(html).not.toContain('전체 내려받기');
  });
});
