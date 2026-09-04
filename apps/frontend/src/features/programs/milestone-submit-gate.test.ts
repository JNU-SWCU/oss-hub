import { describe, expect, it } from 'vitest';
import type { MilestoneDocumentViewerSubmission } from './milestone-document-api';
import { milestoneSubmissionAccess } from './milestone-submission-access';
import {
  milestoneDocumentSubmitGate,
  milestoneRowSubmitGate,
} from './milestone-submit-gate';
import type { ApplicationStatus, ProgramMilestone } from './types';

/**
 * 순서 법칙만 본다 — 화면 문구가 아니라 **무엇을 먼저 말하는가**가 여기서 고정된다.
 * 화면에서 위아래가 함께 그 순서를 따르는지는 `milestone-submission-block.test.tsx`가 본다.
 */

/** 화면이 쓰는 그 판정을 그대로 쓴다 — 손으로 지어내면 순서만 검증되고 값은 새어 나간다. */
function access(applicationStatus: ApplicationStatus | null) {
  return milestoneSubmissionAccess({
    role: 'STUDENT',
    applicationStatus,
  });
}

function submission(
  status: MilestoneDocumentViewerSubmission['status'],
): MilestoneDocumentViewerSubmission {
  return {
    submitted: status !== null,
    submittedAt: status === null ? null : '2026-08-01T10:00:00+09:00',
    revision: status === null ? null : 1,
    status,
    hasCurrentFile: status !== null,
    review: null,
    history: { hasHistory: false, isComplete: true },
  };
}

const OPEN_DUE = '2099-08-20T23:59:59+09:00';
const PAST_DUE = '2020-08-20T23:59:59+09:00';

describe('milestoneDocumentSubmitGate', () => {
  /**
   * 되돌린 승인(APPROVED → SUBMITTED)에서 드러나는 자리다. 신청 상태를 먼저 보면 이미
   * 판정이 끝난 서류가 「승인 후 제출할 수 있습니다」라고 말하는데, 다시 승인돼도 서버는
   * 재제출을 거절한다(MSD_023) — 도달할 수 없는 해결책이다.
   */
  it.each([
    ['APPROVED' as const, '승인된 제출 항목은 다시 제출할 수 없습니다.'],
    ['REJECTED' as const, '반려된 제출 항목은 다시 제출할 수 없습니다.'],
  ])('판정이 끝난 %s 서류는 신청 안내보다 먼저 말한다', (status, note) => {
    expect(
      milestoneDocumentSubmitGate({
        submissionAccess: access('SUBMITTED'),
        viewerSubmission: submission(status),
        closed: false,
      }),
    ).toEqual({ kind: 'settled', note });
  });

  /** 신청 전에도 마찬가지다 — 신청한다고 열리는 서류가 아니다. */
  it('신청 전이어도 판정이 끝난 서류는 그 서류의 이유를 말한다', () => {
    expect(
      milestoneDocumentSubmitGate({
        submissionAccess: access(null),
        viewerSubmission: submission('APPROVED'),
        closed: false,
      }),
    ).toEqual({
      kind: 'settled',
      note: '승인된 제출 항목은 다시 제출할 수 없습니다.',
    });
  });

  /** 마감도 신청 승인이 되돌리지 못한다 — 첫 제출은 마감으로 닫힌다. */
  it('마감이 지난 첫 제출은 신청 안내보다 마감을 먼저 말한다', () => {
    expect(
      milestoneDocumentSubmitGate({
        submissionAccess: access('SUBMITTED'),
        viewerSubmission: submission(null),
        closed: true,
      }),
    ).toEqual({ kind: 'held', note: '마감이 지나 제출할 수 없습니다' });
  });

  /**
   * 마감 예외는 그대로다 — 마감 뒤 보완 요청은 교직원이 요청한 재제출이라 서버도 받는다.
   * 순서를 바꾼 것이지 예외를 없앤 것이 아니다.
   */
  it('마감 뒤 보완 요청은 마감을 지나 신청 상태에 닿는다', () => {
    expect(
      milestoneDocumentSubmitGate({
        submissionAccess: access('SUBMITTED'),
        viewerSubmission: submission('CHANGES_REQUESTED'),
        closed: true,
      }),
    ).toEqual({ kind: 'held', note: '승인 후 제출할 수 있습니다' });
  });

  /**
   * 신청 게이트를 더 아래로 내리지 않는다 — 신청서를 쓰지 않은 학생에게는 걸릴 서류
   * 판정도 마감도 없으니 이것이 그가 할 수 있는 유일한 일이다.
   */
  it.each([
    [null, '신청 후 제출할 수 있습니다'],
    ['SUBMITTED' as const, '승인 후 제출할 수 있습니다'],
  ])('%s 신청은 걸릴 것이 없을 때 신청 상태를 이유로 든다', (status, note) => {
    expect(
      milestoneDocumentSubmitGate({
        submissionAccess: access(status),
        viewerSubmission: submission(null),
        closed: false,
      }),
    ).toEqual({ kind: 'held', note });
  });

  it.each([
    ['APPROVED' as const, null],
    ['APPROVED' as const, 'SUBMITTED' as const],
    ['APPROVED' as const, 'CHANGES_REQUESTED' as const],
    // 반려는 #1098이 답을 정하지 않은 자리 — 옛 화면대로 열어 두고 서버에 맡긴다.
    ['REJECTED' as const, null],
  ])('%s 신청 · %s 서류는 열려 있다', (applicationStatus, status) => {
    expect(
      milestoneDocumentSubmitGate({
        submissionAccess: access(applicationStatus),
        viewerSubmission: submission(status),
        closed: false,
      }),
    ).toEqual({ kind: 'open' });
  });
});

describe('milestoneRowSubmitGate', () => {
  function milestone(
    viewerSubmissionStatus: ProgramMilestone['viewerSubmissionStatus'],
    dueAt: string = OPEN_DUE,
  ): Pick<ProgramMilestone, 'dueAt' | 'viewerSubmissionStatus'> {
    return { dueAt, viewerSubmissionStatus };
  }

  /** 위아래가 같은 법칙을 따른다 — 위만 신청 상태를 먼저 보면 그 줄이 거짓말을 한다. */
  it.each(['APPROVED' as const, 'REJECTED' as const])(
    '판정이 끝난 %s 줄은 신청 안내보다 먼저 말한다',
    (status) => {
      expect(
        milestoneRowSubmitGate(milestone(status), access('SUBMITTED')),
      ).toEqual({ kind: 'settled', status });
    },
  );

  it('마감이 지난 첫 제출 줄은 신청 안내를 내밀지 않는다', () => {
    expect(
      milestoneRowSubmitGate(
        milestone('NOT_SUBMITTED', PAST_DUE),
        access('SUBMITTED'),
      ),
    ).toEqual({ kind: 'settled', status: 'NOT_SUBMITTED' });
  });

  /**
   * 신청서를 쓰지 않은 학생에게는 제출 상태 자체가 없다. 그 자리에서 신청 안내가 밀리면
   * 「제출 상태를 확인할 수 없습니다」만 남아 무엇을 해야 할지 사라진다.
   */
  it('제출 상태가 없으면 신청 안내가 남는다', () => {
    const gate = milestoneRowSubmitGate(milestone(null), access(null));
    expect(gate.kind).toBe('blocked');
    expect(gate).toMatchObject({ access: { reason: 'NOT_APPLIED' } });
  });

  it('승인됐는데 제출 상태만 비어 오면 모른다고 말한다', () => {
    expect(milestoneRowSubmitGate(milestone(null), access('APPROVED'))).toEqual(
      {
        kind: 'unknown',
      },
    );
  });

  /** 반려는 순서 법칙보다 앞이다 — 상태가 와 있어도 #1098 이전 문구 그대로 둔다. */
  it('반려된 신청은 제출 상태와 무관하게 옛 화면으로 간다', () => {
    expect(
      milestoneRowSubmitGate(milestone('APPROVED'), access('REJECTED')),
    ).toEqual({ kind: 'unchanged' });
  });

  it.each([
    ['NOT_SUBMITTED' as const, OPEN_DUE, false],
    ['CHANGES_REQUESTED' as const, PAST_DUE, true],
  ])('%s 줄은 열린 채로 둔다', (status, dueAt, resubmission) => {
    expect(
      milestoneRowSubmitGate(milestone(status, dueAt), access('APPROVED')),
    ).toEqual({ kind: 'open', status, resubmission });
  });
});
