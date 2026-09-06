import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import {
  hasMilestoneDocumentResubmissionDueAtPassed,
  isChangeRequestResubmissionOpen,
  isPostDeadlineResubmissionOpen,
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
        resubmissionDueAt: null,
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
        resubmissionDueAt: null,
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
        resubmissionDueAt: null,
      });

      expect(blocked === null).toBe(screenAllows);
    },
  );

  /**
   * 새 정책의 본체. 교직원이 정한 재제출 기한이 지나면, 아직 한 번도 응하지 않은 보완
   * 요청이라도 창이 닫힌다.
   */
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

  /**
   * 기한이 남아 있어도 **한 번 냈으면 잠긴다**(#1097의 규칙은 그대로다). 기한은 그 한 번을
   * 언제까지 쓸 수 있는지만 정하지, 몇 번 쓸 수 있는지를 늘리지 않는다.
   */
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

  /**
   * 재제출 기한은 **마감이 닫은 것을 다시 여는 창**만 좁힌다. 마감 전 교체는 보완 요청과
   * 무관하게 열려 있는 기능이라, 지난 기한이 그것까지 닫으면 지금 되는 일 하나가 사라진다.
   */
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

  /**
   * 기한 컬럼이 생기기 전에 저장된 보완 요청(=`null`)은 **앞 규칙 그대로** 둔다. 「기한이
   * 없으니 닫힌 것」으로 읽으면, 배포되는 순간 이미 「고쳐서 다시 내세요」를 받고 아직
   * 응하지 않은 학생이 낼 길을 잃는다.
   */
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

  /**
   * 이 함수가 곧 잠금 아래 재확인(`allowAfterDeadline`)의 규칙이다. `milestoneDocumentSubmissionBlock`과
   * 갈라지면 앞에서 막은 재제출이 트랜잭션 안에서 통과한다.
   */
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
  /**
   * `null`은 「기한 없음」이 아니라 「이 컬럼이 생기기 전에 저장된 보완 요청」이다. 이것을
   * 「지났다」로 읽으면 운영 중인 보완 요청이 배포 순간 전부 닫힌다.
   */
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
