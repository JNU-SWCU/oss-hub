import { boundedReviewHistoryQuery } from './milestone-document-history';

describe('milestone document history', () => {
  it('bounds routine review history reads to the latest 50 rows', () => {
    expect(boundedReviewHistoryQuery).toMatchObject({
      take: 50,
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
    });
  });
});
