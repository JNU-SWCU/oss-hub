import {
  boundedReviewHistoryQuery,
  nextMilestoneDocumentHistoryCreatedAt,
} from './milestone-document-history';

describe('milestone document history', () => {
  it('bounds routine review history reads to the latest 50 rows', () => {
    expect(boundedReviewHistoryQuery).toMatchObject({
      take: 50,
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('원장 시각은 직전 사건보다 최소 1ms 뒤로 전진한다', () => {
    const latest = new Date('2026-09-18T09:00:00.000Z');

    expect(
      nextMilestoneDocumentHistoryCreatedAt(
        new Date('2026-09-18T08:59:59.000Z'),
        latest,
      ),
    ).toEqual(new Date('2026-09-18T09:00:00.001Z'));
    expect(
      nextMilestoneDocumentHistoryCreatedAt(
        new Date('2026-09-18T09:00:01.000Z'),
        latest,
      ),
    ).toEqual(new Date('2026-09-18T09:00:01.000Z'));
  });
});
