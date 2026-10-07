import { describe, expect, it } from 'vitest';
import type { MilestoneDocumentViewerSubmission } from './milestone-document-api';
import { milestoneSubmissionAccess } from './milestone-submission-access';
import {
  milestoneDocumentSubmitGate,
  milestoneRowSubmitGate,
} from './milestone-submit-gate';
import type { ApplicationStatus, ProgramMilestone } from './types';

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
    currentFileName: status === null ? null : '합성-제출.pdf',
    review: null,
    history: { hasHistory: false, isComplete: true },
  };
}

const OPEN_DUE = '2099-08-20T23:59:59+09:00';
const PAST_DUE = '2020-08-20T23:59:59+09:00';

describe('milestoneDocumentSubmitGate', () => {
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

  it('마감이 지난 첫 제출은 신청 안내보다 마감을 먼저 말한다', () => {
    expect(
      milestoneDocumentSubmitGate({
        submissionAccess: access('SUBMITTED'),
        viewerSubmission: submission(null),
        closed: true,
      }),
    ).toEqual({ kind: 'held', note: '마감이 지나 제출할 수 없습니다' });
  });

  it('마감 뒤 보완 요청은 마감을 지나 신청 상태에 닿는다', () => {
    expect(
      milestoneDocumentSubmitGate({
        submissionAccess: access('SUBMITTED'),
        viewerSubmission: submission('CHANGES_REQUESTED'),
        closed: true,
      }),
    ).toEqual({ kind: 'held', note: '승인 후 제출할 수 있습니다' });
  });

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
