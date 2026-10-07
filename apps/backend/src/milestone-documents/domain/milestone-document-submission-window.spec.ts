import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import {
  hasMilestoneDocumentResubmissionDueAtPassed,
  isChangeRequestResubmissionOpen,
  isPostDeadlineResubmissionOpen,
  milestoneDocumentSubmissionBlock,
} from './milestone-document-submission-window';

const dueAt = new Date('2026-09-19T09:00:00.000Z');

const beforeDeadline = new Date('2026-09-19T08:59:59.999Z');
const afterDeadline = new Date('2026-09-19T09:00:00.001Z');

describe('milestoneDocumentSubmissionBlock', () => {
  it('마감 전에는 첫 제출과 검토 전 교체를 허용한다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: beforeDeadline,
        hasSubmission: false,
        latestDecision: null,
        submissionStatus: null,
        resubmissionDueAt: null,
      }),
    ).toBeNull();
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: beforeDeadline,
        hasSubmission: true,
        latestDecision: null,
        submissionStatus: SubmissionStatus.SUBMITTED,
        resubmissionDueAt: null,
      }),
    ).toBeNull();
  });

  it('마감 후 첫 제출과 검토 전 교체를 서로 다른 이유로 막는다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: false,
        latestDecision: null,
        submissionStatus: null,
        resubmissionDueAt: null,
      }),
    ).toBe('MILESTONE_CLOSED');
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: true,
        latestDecision: null,
        submissionStatus: SubmissionStatus.SUBMITTED,
        resubmissionDueAt: null,
      }),
    ).toBe('SUBMISSION_REPLACEMENT_CLOSED');
  });

  it('보완 요청을 받고 아직 응하지 않았으면 마감 후에도 다시 제출할 수 있다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: true,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
        resubmissionDueAt: null,
      }),
    ).toBeNull();
  });

  it('보완 요청에 응해 한 번 다시 낸 뒤에는 마감 후 재제출을 막는다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: true,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,

        submissionStatus: SubmissionStatus.SUBMITTED,
        resubmissionDueAt: null,
      }),
    ).toBe('RESUBMISSION_ALREADY_USED');
  });

  it('마감 전이면 보완 요청에 응한 뒤에도 계속 고칠 수 있다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: beforeDeadline,
        hasSubmission: true,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.SUBMITTED,
        resubmissionDueAt: null,
      }),
    ).toBeNull();
  });

  it('제출이 없는데 보완 요청 판정만 있으면 마감으로 막는다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: false,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: null,
        resubmissionDueAt: null,
      }),
    ).toBe('MILESTONE_CLOSED');
  });

  it.each([
    [ReviewDecision.APPROVED, SubmissionStatus.APPROVED],
    [ReviewDecision.REJECTED, SubmissionStatus.REJECTED],
  ])(
    '%s 판정 뒤에는 마감 여부와 관계없이 재제출을 막는다',
    (latestDecision, submissionStatus) => {
      for (const now of [beforeDeadline, afterDeadline]) {
        expect(
          milestoneDocumentSubmissionBlock({
            dueAt,
            now,
            hasSubmission: true,
            latestDecision,
            submissionStatus,
            resubmissionDueAt: null,
          }),
        ).toBe('RESUBMISSION_NOT_ALLOWED');
      }
    },
  );

  it.each([
    [false, null, null, true],
    [false, null, SubmissionStatus.SUBMITTED, true],
    [
      false,
      ReviewDecision.CHANGES_REQUESTED,
      SubmissionStatus.CHANGES_REQUESTED,
      true,
    ],
    [false, ReviewDecision.CHANGES_REQUESTED, SubmissionStatus.SUBMITTED, true],
    [false, ReviewDecision.APPROVED, SubmissionStatus.APPROVED, false],
    [false, ReviewDecision.REJECTED, SubmissionStatus.REJECTED, false],
    [true, null, null, false],
    [true, null, SubmissionStatus.SUBMITTED, false],
    [
      true,
      ReviewDecision.CHANGES_REQUESTED,
      SubmissionStatus.CHANGES_REQUESTED,
      true,
    ],
    [true, ReviewDecision.CHANGES_REQUESTED, SubmissionStatus.SUBMITTED, false],
    [true, ReviewDecision.APPROVED, SubmissionStatus.APPROVED, false],
    [true, ReviewDecision.REJECTED, SubmissionStatus.REJECTED, false],
  ] as const)(
    '마감 지남=%s · 판정=%s · 상태=%s 에서 서버 허용은 화면 허용(%s)과 같다',
    (closed, latestDecision, submissionStatus, screenAllows) => {
      const blocked = milestoneDocumentSubmissionBlock({
        dueAt,
        now: closed ? afterDeadline : beforeDeadline,
        hasSubmission: submissionStatus !== null,
        latestDecision,
        submissionStatus,
        resubmissionDueAt: null,
      });

      expect(blocked === null).toBe(screenAllows);
    },
  );

  it('재제출 기한이 지나면 아직 응하지 않은 보완 요청도 막는다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: new Date('2026-09-26T09:00:00.001Z'),
        hasSubmission: true,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
        resubmissionDueAt: new Date('2026-09-26T09:00:00.000Z'),
      }),
    ).toBe('RESUBMISSION_DUE_AT_PASSED');
  });

  it('재제출 기한이 남아 있으면 마감 뒤에도 그 한 번을 연다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: new Date('2026-09-26T08:59:59.999Z'),
        hasSubmission: true,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
        resubmissionDueAt: new Date('2026-09-26T09:00:00.000Z'),
      }),
    ).toBeNull();
  });

  it('기한이 남아도 이미 다시 낸 서류는 잠근다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: new Date('2026-09-26T08:59:59.999Z'),
        hasSubmission: true,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.SUBMITTED,
        resubmissionDueAt: new Date('2026-09-26T09:00:00.000Z'),
      }),
    ).toBe('RESUBMISSION_ALREADY_USED');
  });

  it('마감 전에는 재제출 기한이 지났어도 막지 않는다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: beforeDeadline,
        hasSubmission: true,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
        resubmissionDueAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ).toBeNull();
  });

  it('기한 없는 옛 보완 요청은 앞 규칙대로 한 번을 그대로 연다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: true,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
        resubmissionDueAt: null,
      }),
    ).toBeNull();
  });
});

describe('isPostDeadlineResubmissionOpen', () => {
  const dueAt = new Date('2026-09-26T09:00:00.000Z');

  it('아직 응하지 않았고 기한도 남았을 때만 참이다', () => {
    expect(
      isPostDeadlineResubmissionOpen({
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
        resubmissionDueAt: dueAt,
        now: new Date('2026-09-26T08:59:59.999Z'),
      }),
    ).toBe(true);
  });

  it('기한이 지나면 거짓이다', () => {
    expect(
      isPostDeadlineResubmissionOpen({
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
        resubmissionDueAt: dueAt,
        now: new Date('2026-09-26T09:00:00.001Z'),
      }),
    ).toBe(false);
  });

  it('이미 다시 낸 자리는 기한이 남아도 거짓이다', () => {
    expect(
      isPostDeadlineResubmissionOpen({
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.SUBMITTED,
        resubmissionDueAt: dueAt,
        now: new Date('2026-09-26T08:59:59.999Z'),
      }),
    ).toBe(false);
  });
});

describe('hasMilestoneDocumentResubmissionDueAtPassed', () => {
  it('기한이 없으면 지나지 않은 것으로 본다', () => {
    expect(
      hasMilestoneDocumentResubmissionDueAtPassed(
        null,
        new Date('2099-01-01T00:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('기한과 같은 순간은 아직 지나지 않았다 — 마감 판정과 같은 경계다', () => {
    const at = new Date('2026-09-26T09:00:00.000Z');
    expect(hasMilestoneDocumentResubmissionDueAtPassed(at, at)).toBe(false);
    expect(
      hasMilestoneDocumentResubmissionDueAtPassed(
        at,
        new Date(at.getTime() + 1),
      ),
    ).toBe(true);
  });
});

describe('isChangeRequestResubmissionOpen', () => {
  it('보완 요청을 받고 아직 응하지 않은 자리에서만 참이다', () => {
    expect(
      isChangeRequestResubmissionOpen({
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
      }),
    ).toBe(true);
  });

  it('이미 다시 낸 자리에서는 거짓이다 — 그 한 번이 마감을 지나가는 전부다', () => {
    expect(
      isChangeRequestResubmissionOpen({
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.SUBMITTED,
      }),
    ).toBe(false);
  });

  it('판정이 보완 요청이 아니면 상태가 무엇이든 거짓이다', () => {
    for (const latestDecision of [
      null,
      ReviewDecision.APPROVED,
      ReviewDecision.REJECTED,
    ] as const) {
      expect(
        isChangeRequestResubmissionOpen({
          latestDecision,
          submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
        }),
      ).toBe(false);
    }
  });
});
