import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MilestoneDocumentCollectionHistory } from './milestone-document-collection-api';
import { MilestoneDocumentHistoryTimeline } from './milestone-document-history-timeline';

const history: readonly MilestoneDocumentCollectionHistory[] = [
  {
    event: 'SUBMITTED',
    revision: 1,
    actorNickname: 'synthetic-student',
    comment: null,
    createdAt: '2026-09-16T14:22:00.000Z',
    fileName: null,
    content: { type: 'TEXT', text: '합성 제출 내용' },
  },
];

describe('MilestoneDocumentHistoryTimeline', () => {
  it('여러 제출 항목의 제목 id와 aria-labelledby가 서로 겹치지 않는다', () => {
    const html = renderToStaticMarkup(
      <>
        <MilestoneDocumentHistoryTimeline history={history} />
        <MilestoneDocumentHistoryTimeline history={history} />
      </>,
    );
    const labelledBy = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(labelledBy).toHaveLength(2);
    expect(new Set(labelledBy).size).toBe(2);
    for (const id of labelledBy) expect(html).toContain(`id="${id}"`);
  });
});
