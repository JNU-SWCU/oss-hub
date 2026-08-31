import { ReviewDecision } from '@prisma/client';
import { milestoneDocumentSubmissionBlock } from './milestone-document-submission-window';

const dueAt = new Date('2026-09-19T09:00:00.000Z');

describe('milestoneDocumentSubmissionBlock', () => {
  it('마감 전에는 첫 제출과 검토 전 교체를 허용한다', () => {
    const now = new Date('2026-09-19T08:59:59.999Z');

    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now,
        hasSubmission: false,
        latestDecision: null,
      }),
    ).toBeNull();
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now,
        hasSubmission: true,
        latestDecision: null,
      }),
    ).toBeNull();
  });

  it('마감 후 첫 제출과 검토 전 교체를 서로 다른 이유로 막는다', () => {
    const now = new Date('2026-09-19T09:00:00.001Z');

    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now,
        hasSubmission: false,
        latestDecision: null,
      }),
    ).toBe('MILESTONE_CLOSED');
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now,
        hasSubmission: true,
        latestDecision: null,
      }),
    ).toBe('SUBMISSION_REPLACEMENT_CLOSED');
  });

  it('보완 요청 뒤에는 마감 후에도 다시 제출할 수 있다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: new Date('2026-09-20T00:00:00.000Z'),
        hasSubmission: true,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
      }),
    ).toBeNull();
  });

  it.each([ReviewDecision.APPROVED, ReviewDecision.REJECTED])(
    '%s 판정 뒤에는 마감 여부와 관계없이 재제출을 막는다',
    (latestDecision) => {
      expect(
        milestoneDocumentSubmissionBlock({
          dueAt,
          now: new Date('2026-09-18T00:00:00.000Z'),
          hasSubmission: true,
          latestDecision,
        }),
      ).toBe('RESUBMISSION_NOT_ALLOWED');
    },
  );
});
