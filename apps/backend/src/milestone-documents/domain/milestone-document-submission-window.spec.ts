import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import {
  isChangeRequestResubmissionOpen,
  milestoneDocumentSubmissionBlock,
} from './milestone-document-submission-window';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const dueAt = new Date('2026-09-19T09:00:00.000Z');
/**
 * 시각은 **전부 인자로 준다**. 서비스 기본값(`now = new Date()`)에 기대면 고정된 `dueAt`이
 * 지나는 날 이 파일이 통째로 색을 바꾼다 — 코드가 아니라 달력이 테스트를 깨뜨린다.
 */
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
      }),
    ).toBeNull();
    expect(
      milestoneDocumentSubmissionBlock({
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
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: false,
        latestDecision: null,
        submissionStatus: null,
      }),
    ).toBe('MILESTONE_CLOSED');
    expect(
      milestoneDocumentSubmissionBlock({
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
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: true,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
      }),
    ).toBeNull();
  });

  /**
   * #1097의 본체. 판정만 보면 이 자리가 계속 열려 재제출이 무제한이 되고, 화면은 상태를 보고
   * 잠그므로 **버튼은 잠겼는데 서버는 받아 주는** 어긋남이 생긴다. 정해진 규칙은 「재제출은
   * 한 번」·「검토 중에는 내용이 바뀌지 않는다」라, 서버가 화면을 따라온다.
   */
  it('보완 요청에 응해 한 번 다시 낸 뒤에는 마감 후 재제출을 막는다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: true,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        // 재제출이 상태를 여기로 되돌려 놓았다. 판정 이력은 되돌아가지 않는다.
        submissionStatus: SubmissionStatus.SUBMITTED,
      }),
    ).toBe('RESUBMISSION_ALREADY_USED');
  });

  /**
   * 그 잠금은 **마감이** 만든다. 마감 전이라면 같은 상태에서도 그대로 낼 수 있어야 한다 —
   * 여기까지 잠그면 마감 전 파일 교체가 사라진다.
   */
  it('마감 전이면 보완 요청에 응한 뒤에도 계속 고칠 수 있다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: beforeDeadline,
        hasSubmission: true,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: SubmissionStatus.SUBMITTED,
      }),
    ).toBeNull();
  });

  /**
   * 판정만 있고 제출 행이 없는 조합은 계약에 없다(판정은 제출에 붙는다). 그래도 그런 값이 오면
   * 「미제출인데 재제출을 다 썼다」가 아니라 마감 그대로를 말해야 한다.
   */
  it('제출이 없는데 보완 요청 판정만 있으면 마감으로 막는다', () => {
    expect(
      milestoneDocumentSubmissionBlock({
        dueAt,
        now: afterDeadline,
        hasSubmission: false,
        latestDecision: ReviewDecision.CHANGES_REQUESTED,
        submissionStatus: null,
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
          }),
        ).toBe('RESUBMISSION_NOT_ALLOWED');
      }
    },
  );

  /**
   * 화면(`isMilestoneDocumentDeadlineLocked` + `isMilestoneDocumentResubmittable`)이 그리는
   * 잠금과 **한 칸도 어긋나지 않아야** 한다 — 그것이 #1097의 완료 조건이다. 화면 쪽 같은 표는
   * `apps/frontend/src/features/programs/milestone-document-review.test.ts`에 있다.
   */
  it.each([
    // [마감 지남, 최신 판정, 제출 상태, 화면이 조작을 여는가]
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
      });

      expect(blocked === null).toBe(screenAllows);
    },
  );
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

  /**
   * 상태만 보면 뚫리는 자리. 승인 뒤에 상태가 어긋나 `CHANGES_REQUESTED`로 오더라도 마감
   * 예외를 열어 주면 안 된다 — 판정 축을 함께 보는 이유다.
   */
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
