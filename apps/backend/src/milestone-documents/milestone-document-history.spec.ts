import {
  MilestoneDocumentSubmissionHistoryEvent,
  ReviewDecision,
} from '@prisma/client';
import {
  boundedReviewHistoryQuery,
  collectionHistory,
} from './milestone-document-history';

describe('milestone document history', () => {
  it('bounds routine review history reads to the latest 50 rows', () => {
    expect(boundedReviewHistoryQuery).toMatchObject({
      take: 50,
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('orders a submission before its review even when timestamps are equal', () => {
    const createdAt = new Date('2026-09-16T14:22:00.000Z');
    const history = collectionHistory(
      [
        {
          event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
          revision: 1,
          comment: null,
          content: null,
          createdAt,
          actor: { nickname: 'synthetic-student' },
          files: [],
        },
      ],
      [
        {
          decision: ReviewDecision.APPROVED,
          comment: null,
          reviewedAt: createdAt,
          reviewer: { nickname: 'synthetic-staff' },
          submissionHistory: { revision: 1 },
        },
      ],
    );

    expect(history.map((event) => event.event)).toEqual([
      MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
      MilestoneDocumentSubmissionHistoryEvent.APPROVED,
    ]);
  });
});
