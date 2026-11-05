import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReviewHistoryEntry } from './dto';
import { ReviewHistoryTimeline } from './review-history-timeline';

function entry(revision: number | null): ReviewHistoryEntry {
  return {
    id: 'history-1',
    eventKind: 'SUBMITTED',
    revision,
    actor: { name: '홍길동', nickname: 'gildong' },
    occurredAt: '2026-09-01T00:00:00Z',
    rejectionReason: null,
  };
}

describe('ReviewHistoryTimeline', () => {
  it('차수가 있으면 차수를 보여준다', () => {
    const html = renderToStaticMarkup(
      <ReviewHistoryTimeline entries={[entry(2)]} />,
    );
    expect(html).toContain('2차');
  });

  it('차수를 알 수 없으면 차수 표시를 만들지 않는다', () => {
    const html = renderToStaticMarkup(
      <ReviewHistoryTimeline entries={[entry(null)]} />,
    );
    expect(html).not.toContain('차<');
    expect(html).not.toContain('null');
  });
});
