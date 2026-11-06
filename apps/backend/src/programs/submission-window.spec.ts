import { ProgramScheduleService } from './program-schedule.service';
import { SubmissionWindowService } from './files.service';
import { SubmissionStatus } from '@prisma/client';

const submissionWindowService = new SubmissionWindowService(
  new ProgramScheduleService(),
);

const dueAt = new Date('2026-09-19T09:00:00.000Z');

const beforeDeadline = new Date('2026-09-19T08:59:59.999Z');
const afterDeadline = new Date('2026-09-19T09:00:00.001Z');

describe('submissionBlock', () => {
  it('마감 전에는 첫 제출과 검토 전 교체를 허용한다', () => {
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: beforeDeadline,
        hasSubmission: false,
        latestDecision: null,
        submissionStatus: null,
      }),
    ).toBeNull();
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: beforeDeadline,
        hasSubmission: true,
        latestDecision: null,
        submissionStatus: SubmissionStatus.SUBMITTED,
      }),
    ).toBeNull();
  });

  it('마감 후 첫 제출과 검토 전 교체를 서로 다른 이유로 막는다', () => {
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: false,
        latestDecision: null,
        submissionStatus: null,
      }),
    ).toBe('MILESTONE_CLOSED');
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: true,
        latestDecision: null,
        submissionStatus: SubmissionStatus.SUBMITTED,
      }),
    ).toBe('SUBMISSION_REPLACEMENT_CLOSED');
  });

  it('보완 요청을 받고 아직 응하지 않았으면 마감 후에도 다시 제출할 수 있다', () => {
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: true,
        latestDecision: 'CHANGES_REQUESTED',
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
      }),
    ).toBeNull();
  });

  it('보완 요청에 응해 한 번 다시 낸 뒤에는 마감 후 재제출을 막는다', () => {
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: true,
        latestDecision: 'CHANGES_REQUESTED',

        submissionStatus: SubmissionStatus.SUBMITTED,
      }),
    ).toBe('RESUBMISSION_ALREADY_USED');
  });

  it('마감 전이면 보완 요청에 응한 뒤에도 계속 고칠 수 있다', () => {
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: beforeDeadline,
        hasSubmission: true,
        latestDecision: 'CHANGES_REQUESTED',
        submissionStatus: SubmissionStatus.SUBMITTED,
      }),
    ).toBeNull();
  });

  it('제출이 없는데 보완 요청 판정만 있으면 마감으로 막는다', () => {
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: false,
        latestDecision: 'CHANGES_REQUESTED',
        submissionStatus: null,
      }),
    ).toBe('MILESTONE_CLOSED');
  });

  it.each([
    ['APPROVED', SubmissionStatus.APPROVED],
    ['REJECTED', SubmissionStatus.REJECTED],
  ] as const)(
    '%s 판정 뒤에는 마감 여부와 관계없이 재제출을 막는다',
    (latestDecision, submissionStatus) => {
      for (const now of [beforeDeadline, afterDeadline]) {
        expect(
          submissionWindowService.submissionBlock({
            dueAt,
            now,
            hasSubmission: true,
            latestDecision,
            submissionStatus,
          }),
        ).toBe('RESUBMISSION_NOT_ALLOWED');
      }
    },
  );

  it.each([
    [false, null, null, true],
    [false, null, SubmissionStatus.SUBMITTED, true],
    [false, 'CHANGES_REQUESTED', SubmissionStatus.CHANGES_REQUESTED, true],
    [false, 'CHANGES_REQUESTED', SubmissionStatus.SUBMITTED, true],
    [false, 'APPROVED', SubmissionStatus.APPROVED, false],
    [false, 'REJECTED', SubmissionStatus.REJECTED, false],
    [true, null, null, false],
    [true, null, SubmissionStatus.SUBMITTED, false],
    [true, 'CHANGES_REQUESTED', SubmissionStatus.CHANGES_REQUESTED, true],
    [true, 'CHANGES_REQUESTED', SubmissionStatus.SUBMITTED, false],
    [true, 'APPROVED', SubmissionStatus.APPROVED, false],
    [true, 'REJECTED', SubmissionStatus.REJECTED, false],
  ] as const)(
    '마감 지남=%s · 판정=%s · 상태=%s 에서 서버 허용은 화면 허용(%s)과 같다',
    (closed, latestDecision, submissionStatus, screenAllows) => {
      const blocked = submissionWindowService.submissionBlock({
        dueAt,
        now: closed ? afterDeadline : beforeDeadline,
        hasSubmission: submissionStatus !== null,
        latestDecision,
        submissionStatus,
      });

      expect(blocked === null).toBe(screenAllows);
    },
  );

  it('마감이 한참 지나도 응하지 않은 보완 요청은 다시 제출할 수 있다', () => {
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: new Date('2026-09-26T09:00:00.001Z'),
        hasSubmission: true,
        latestDecision: 'CHANGES_REQUESTED',
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
      }),
    ).toBeNull();
  });

  it('마감 뒤 보완 요청에는 한 번 다시 제출할 수 있다', () => {
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: new Date('2026-09-26T08:59:59.999Z'),
        hasSubmission: true,
        latestDecision: 'CHANGES_REQUESTED',
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
      }),
    ).toBeNull();
  });

  it('마감 뒤 이미 다시 낸 서류는 잠근다', () => {
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: new Date('2026-09-26T08:59:59.999Z'),
        hasSubmission: true,
        latestDecision: 'CHANGES_REQUESTED',
        submissionStatus: SubmissionStatus.SUBMITTED,
      }),
    ).toBe('RESUBMISSION_ALREADY_USED');
  });

  it('마감 전에는 보완 요청을 받은 서류를 수정할 수 있다', () => {
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: beforeDeadline,
        hasSubmission: true,
        latestDecision: 'CHANGES_REQUESTED',
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
      }),
    ).toBeNull();
  });

  it('보완 요청은 별도 기한 없이 한 번 다시 제출할 수 있다', () => {
    expect(
      submissionWindowService.submissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: true,
        latestDecision: 'CHANGES_REQUESTED',
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
      }),
    ).toBeNull();
  });
});

describe('isChangeRequestResubmissionOpen', () => {
  it('보완 요청을 받고 아직 응하지 않은 자리에서만 참이다', () => {
    expect(
      submissionWindowService.isChangeRequestResubmissionOpen({
        latestDecision: 'CHANGES_REQUESTED',
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
      }),
    ).toBe(true);
  });

  it('이미 다시 낸 자리에서는 거짓이다 — 그 한 번이 마감을 지나가는 전부다', () => {
    expect(
      submissionWindowService.isChangeRequestResubmissionOpen({
        latestDecision: 'CHANGES_REQUESTED',
        submissionStatus: SubmissionStatus.SUBMITTED,
      }),
    ).toBe(false);
  });

  it('판정이 보완 요청이 아니면 상태가 무엇이든 거짓이다', () => {
    for (const latestDecision of [null, 'APPROVED', 'REJECTED'] as const) {
      expect(
        submissionWindowService.isChangeRequestResubmissionOpen({
          latestDecision,
          submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
        }),
      ).toBe(false);
    }
  });
});

describe('document grace window', () => {
  const graceDueAt = new Date('2026-09-20T00:00:00+09:00');
  const base = {
    dueAt,
    graceDueAt,
    hasSubmission: false,
    latestDecision: null,
    submissionStatus: null,
  };

  it.each([false, true])(
    '유예 기한까지 첫 제출/교체를 허용한다: %s',
    (hasSubmission) => {
      const input = {
        ...base,
        hasSubmission,
        submissionStatus: hasSubmission ? SubmissionStatus.SUBMITTED : null,
        now: graceDueAt,
      };
      expect(submissionWindowService.submissionBlock(input)).toBeNull();
    },
  );

  it('유예 기한 1ms 뒤에는 다시 마감한다', () => {
    const input = { ...base, now: new Date(graceDueAt.getTime() + 1) };
    expect(submissionWindowService.submissionBlock(input)).toBe(
      'MILESTONE_CLOSED',
    );
  });

  it.each(['APPROVED', 'REJECTED'] as const)(
    '유예가 확정 검토를 우회하지 않는다: %s',
    (latestDecision) => {
      const input = {
        ...base,
        now: afterDeadline,
        hasSubmission: true,
        latestDecision,
      };
      expect(submissionWindowService.submissionBlock(input)).toBe(
        'RESUBMISSION_NOT_ALLOWED',
      );
    },
  );

  it('유예 기간에도 응하지 않은 보완 요청의 재제출을 허용한다', () => {
    const input = {
      ...base,
      now: afterDeadline,
      hasSubmission: true,
      latestDecision: 'CHANGES_REQUESTED' as const,
      submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
    };
    expect(submissionWindowService.submissionBlock(input)).toBeNull();
  });

  it('유예가 이미 사용한 보완 재제출을 다시 열지 않는다', () => {
    const input = {
      ...base,
      now: afterDeadline,
      hasSubmission: true,
      latestDecision: 'CHANGES_REQUESTED' as const,
      submissionStatus: SubmissionStatus.SUBMITTED,
    };
    expect(submissionWindowService.submissionBlock(input)).toBe(
      'RESUBMISSION_ALREADY_USED',
    );
  });
});
