import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MilestoneDocumentCollectionSummary } from './milestone-document-collection-summary';
import type { MilestoneDocumentCollection } from './milestone-document-collection-api';

function collection(
  total: number,
  submitted: number,
): MilestoneDocumentCollection {
  return {
    milestone: {
      id: 'milestone',
      programId: 'program',
      name: '최종 제출',
      dueAt: '2026-10-01T00:00:00Z',
    },
    documents: [
      { id: 'report', name: '활동 사진', isRequired: false, sortOrder: 1 },
    ],
    rows: [],
    page: 2,
    pageSize: 20,
    total: 0,
    filterCounts: { all: total, hasMissing: 0, zeroSubmission: total },
    deliveryCounts: {
      missing: 0,
      complete: 0,
      late: 0,
      noRequiredItems: total,
    },
    documentTotals: [{ documentId: 'report', total, submitted }],
  };
}

it('uses milestone totals even on an empty filtered page and names optional omissions honestly', () => {
  const html = renderToStaticMarkup(
    <MilestoneDocumentCollectionSummary
      data={collection(47, 30)}
      selection={{ id: 'report', submissionState: 'MISSING' }}
      onSelectionChange={() => {}}
    />,
  );
  expect(html).toContain('제출 30 / 47팀');
  expect(html).toContain('미제출 17팀');
  expect(html).toContain(
    '선택 서류의 미제출은 필수 서류 제출 상태에 영향을 주지 않습니다.',
  );
  expect(html).toContain('aria-label="활동 사진 제출 여부"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('모든 서류 보기');
});

it('reports zero approved teams without claiming full submission', () => {
  const html = renderToStaticMarkup(
    <MilestoneDocumentCollectionSummary
      data={collection(0, 0)}
      selection={null}
      onSelectionChange={() => {}}
    />,
  );
  expect(html).toContain('제출 0 / 0팀');
  expect(html).toContain('전체 0팀');
  expect(html).not.toContain('완료');
});
