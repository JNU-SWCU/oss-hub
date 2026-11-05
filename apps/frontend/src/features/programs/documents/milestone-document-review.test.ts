import { describe, expect, it } from 'vitest';
import type {
  MilestoneDocumentSubmissionStatus,
  MilestoneDocumentViewerSubmission,
} from './milestone-document-dto';
import type { MilestoneDocumentCollectionCell } from './milestone-document-collection-dto';
import {
  createMilestoneDocumentReviewFormState,
  isMilestoneDocumentDeadlineLocked,
  isMilestoneDocumentResubmissionFinal,
  isMilestoneDocumentResubmittable,
  isSameMilestoneDocumentReviewTarget,
  MILESTONE_DOCUMENT_REVIEW_DECISION_ORDER,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS,
  milestoneDocumentCellDisplay,
  milestoneDocumentReviewCommentPayload,
  milestoneDocumentReviewFormError,
  milestoneDocumentReviewNoticeTone,
  milestoneDocumentReviewVersionError,
  milestoneDocumentReviewVersionOf,
  milestoneDocumentViewerDisplay,
  nextMilestoneDocumentReviewState,
  shouldHighlightMilestoneDocumentReview,
} from './milestone-document-review';

function viewer(
  overrides: Partial<MilestoneDocumentViewerSubmission> = {},
): MilestoneDocumentViewerSubmission {
  return {
    submitted: true,
    submittedAt: '2026-08-01T00:00:00.000Z',
    revision: 1,
    status: 'SUBMITTED',
    hasCurrentFile: false,
    currentFileName: null,
    review: null,
    history: { hasHistory: true, isComplete: true },
    ...overrides,
  };
}

describe('milestoneDocumentCellDisplay', () => {
  it('미제출은 상태를 보기 전에 미제출이다', () => {
    expect(
      milestoneDocumentCellDisplay({ isSubmitted: false, status: null }),
    ).toBe('NOT_SUBMITTED');
  });

  it('미제출 칸에 상태가 실려 와도 미제출로 읽는다', () => {
    expect(
      milestoneDocumentCellDisplay({
        isSubmitted: false,
        status: 'APPROVED',
      }),
    ).toBe('NOT_SUBMITTED');
  });

  it('냈지만 아무도 보지 않았으면 검토 대기다', () => {
    expect(
      milestoneDocumentCellDisplay({ isSubmitted: true, status: 'SUBMITTED' }),
    ).toBe('PENDING');
  });

  it('상태가 비어 와도 낸 칸은 검토 대기다', () => {
    expect(
      milestoneDocumentCellDisplay({ isSubmitted: true, status: null }),
    ).toBe('PENDING');
  });

  it('판정이 옮겨 놓은 상태는 그대로 말한다', () => {
    for (const decision of MILESTONE_DOCUMENT_REVIEW_DECISION_ORDER) {
      expect(
        milestoneDocumentCellDisplay({ isSubmitted: true, status: decision }),
      ).toBe(decision);
    }
  });

  it('다시 낸 칸은 지난 보완 요청이 남아 있어도 검토 대기다', () => {
    const resubmitted: MilestoneDocumentCollectionCell = {
      documentId: 'd1',
      isSubmitted: true,
      status: 'SUBMITTED',
      revision: 2,
      submittedAt: '2026-08-03T00:00:00.000Z',
      file: null,
      content: null,
      review: {
        id: 'review-1',
        decision: 'CHANGES_REQUESTED',
        comment: '표지를 고쳐 주세요.',
        reviewedAt: '2026-08-01T00:00:00.000Z',
      },
    };

    expect(milestoneDocumentCellDisplay(resubmitted)).toBe('PENDING');
  });
});

describe('milestoneDocumentViewerDisplay', () => {
  it('교직원 뷰(값 없음)와 미제출은 둘 다 미제출이다', () => {
    expect(milestoneDocumentViewerDisplay(undefined)).toBe('NOT_SUBMITTED');
    expect(
      milestoneDocumentViewerDisplay(
        viewer({ submitted: false, submittedAt: null, status: null }),
      ),
    ).toBe('NOT_SUBMITTED');
  });

  it('제출됨은 제출본 번호와 무관하게 검토 대기다', () => {
    for (const revision of [1, 2, 7]) {
      expect(
        milestoneDocumentViewerDisplay(
          viewer({ status: 'SUBMITTED', revision }),
        ),
      ).toBe('PENDING');
    }
  });

  it('판정 상태는 그대로 말한다', () => {
    const statuses: readonly MilestoneDocumentSubmissionStatus[] = [
      'APPROVED',
      'CHANGES_REQUESTED',
      'REJECTED',
    ];
    for (const status of statuses) {
      expect(milestoneDocumentViewerDisplay(viewer({ status }))).toBe(status);
    }
  });
});

describe('배지 표', () => {
  it('다섯 갈래를 이 말로 부른다', () => {
    expect(MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS).toEqual({
      NOT_SUBMITTED: '미제출',
      PENDING: '검토 대기',
      APPROVED: '승인',
      CHANGES_REQUESTED: '보완 요청',
      REJECTED: '반려',
    });
  });

  it('다섯 갈래의 색이 서로 겹치지 않는다', () => {
    const variants = Object.values(MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS);
    expect(new Set(variants).size).toBe(5);
  });

  it('전부 기존 StatusBadge 변형이다', () => {
    const known = ['recruiting', 'closed', 'pending', 'approved', 'rejected'];
    for (const variant of Object.values(
      MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS,
    )) {
      expect(known).toContain(variant);
    }
  });
});

describe('isMilestoneDocumentResubmittable', () => {
  it('승인·반려는 막는다', () => {
    expect(
      isMilestoneDocumentResubmittable(viewer({ status: 'APPROVED' })),
    ).toBe(false);
    expect(
      isMilestoneDocumentResubmittable(viewer({ status: 'REJECTED' })),
    ).toBe(false);
  });

  it('보완 요청은 연다', () => {
    expect(
      isMilestoneDocumentResubmittable(viewer({ status: 'CHANGES_REQUESTED' })),
    ).toBe(true);
  });

  it('미제출과 검토 대기는 연다', () => {
    expect(
      isMilestoneDocumentResubmittable(
        viewer({ submitted: false, submittedAt: null, status: null }),
      ),
    ).toBe(true);
    expect(
      isMilestoneDocumentResubmittable(viewer({ status: 'SUBMITTED' })),
    ).toBe(true);
    expect(isMilestoneDocumentResubmittable(undefined)).toBe(true);
  });
});

describe('isMilestoneDocumentDeadlineLocked', () => {
  it.each([
    [false, 'SUBMITTED', false],
    [true, 'SUBMITTED', true],
    [true, 'APPROVED', true],
    [true, 'REJECTED', true],
    [true, 'CHANGES_REQUESTED', false],
  ] as const)(
    'closed=%s, status=%s preserves the milestone cutoff (%s)',
    (closed, status, locked) => {
      expect(
        isMilestoneDocumentDeadlineLocked(closed, viewer({ status })),
      ).toBe(locked);
    },
  );
  it('keeps a changes request open after the milestone deadline', () => {
    expect(
      isMilestoneDocumentDeadlineLocked(
        true,
        viewer({
          status: 'CHANGES_REQUESTED',
          review: { comment: null, reviewedAt: '2026-08-01T00:00:00Z' },
        }),
      ),
    ).toBe(false);
  });
});

describe('isMilestoneDocumentResubmissionFinal', () => {
  it('마감 뒤 아직 응하지 않은 보완 요청에서만 참이다', () => {
    expect(
      isMilestoneDocumentResubmissionFinal(
        true,
        viewer({ status: 'CHANGES_REQUESTED' }),
      ),
    ).toBe(true);
    expect(
      isMilestoneDocumentResubmissionFinal(
        false,
        viewer({ status: 'CHANGES_REQUESTED' }),
      ),
    ).toBe(false);
    for (const status of ['SUBMITTED', 'APPROVED', 'REJECTED'] as const) {
      expect(
        isMilestoneDocumentResubmissionFinal(true, viewer({ status })),
      ).toBe(false);
    }
    expect(isMilestoneDocumentResubmissionFinal(true, undefined)).toBe(false);
  });
});

describe('shouldHighlightMilestoneDocumentReview', () => {
  it('보완 요청·반려만 경고 톤으로 키운다', () => {
    expect(shouldHighlightMilestoneDocumentReview('CHANGES_REQUESTED')).toBe(
      true,
    );
    expect(shouldHighlightMilestoneDocumentReview('REJECTED')).toBe(true);
    expect(shouldHighlightMilestoneDocumentReview('APPROVED')).toBe(false);
    expect(shouldHighlightMilestoneDocumentReview('PENDING')).toBe(false);
    expect(shouldHighlightMilestoneDocumentReview('NOT_SUBMITTED')).toBe(false);
  });
});

describe('milestoneDocumentReviewNoticeTone', () => {
  it('보완 요청·반려는 사유 유무와 무관하게 경고 톤이다', () => {
    expect(
      milestoneDocumentReviewNoticeTone(
        'CHANGES_REQUESTED',
        '표지를 고쳐 주세요.',
      ),
    ).toBe('warning');
    expect(
      milestoneDocumentReviewNoticeTone('REJECTED', '기한을 넘겼습니다.'),
    ).toBe('warning');

    expect(milestoneDocumentReviewNoticeTone('CHANGES_REQUESTED', null)).toBe(
      'warning',
    );
    expect(milestoneDocumentReviewNoticeTone('REJECTED', null)).toBe('warning');
  });

  it('사유를 적은 승인은 중립 톤으로 보여 준다', () => {
    expect(
      milestoneDocumentReviewNoticeTone(
        'APPROVED',
        '잘 받았습니다. 다음 단계를 안내드릴게요.',
      ),
    ).toBe('neutral');
  });

  it('사유 없는 승인에는 상자를 세우지 않는다', () => {
    expect(milestoneDocumentReviewNoticeTone('APPROVED', null)).toBeNull();
    expect(milestoneDocumentReviewNoticeTone('APPROVED', '   ')).toBeNull();
  });

  it('검토 대기·미제출에는 그리지 않는다', () => {
    expect(
      milestoneDocumentReviewNoticeTone('PENDING', '지난 지적'),
    ).toBeNull();
    expect(
      milestoneDocumentReviewNoticeTone('NOT_SUBMITTED', '지난 지적'),
    ).toBeNull();
  });
});

describe('milestoneDocumentReviewFormError', () => {
  it('requires a decision', () => {
    expect(milestoneDocumentReviewFormError(null, '')).not.toBeNull();
  });
  it.each(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'] as const)(
    '%s accepts no reason or deadline while enforcing the comment limit',
    (decision) => {
      expect(milestoneDocumentReviewFormError(decision, '')).toBeNull();
      expect(milestoneDocumentReviewFormError(decision, '  \n\t')).toBeNull();
      expect(
        milestoneDocumentReviewFormError(decision, 'x'.repeat(2000)),
      ).toBeNull();
      expect(
        milestoneDocumentReviewFormError(decision, 'x'.repeat(2001)),
      ).not.toBeNull();
    },
  );
});

describe('milestoneDocumentReviewCommentPayload', () => {
  it('앞뒤 공백을 떼어 보낸다', () => {
    expect(milestoneDocumentReviewCommentPayload('  고쳐 주세요.  ')).toBe(
      '고쳐 주세요.',
    );
  });

  it('공백만 남으면 아예 싣지 않는다', () => {
    expect(milestoneDocumentReviewCommentPayload('   ')).toBeUndefined();
    expect(milestoneDocumentReviewCommentPayload('')).toBeUndefined();
  });
});

describe('milestoneDocumentReviewVersionOf', () => {
  it('칸의 제출본 번호와 최신 판정 id를 그대로 뜬다', () => {
    expect(
      milestoneDocumentReviewVersionOf({
        revision: 3,
        review: {
          id: 'review-7',
          decision: 'CHANGES_REQUESTED',
          comment: '표지를 고쳐 주세요.',
          reviewedAt: '2026-07-29T00:00:00.000Z',
        },
      }),
    ).toEqual({
      expectedRevision: 3,
      expectedLatestReviewId: 'review-7',
    });
  });

  it('판정이 없던 칸은 undefined가 아니라 null을 싣는다', () => {
    const version = milestoneDocumentReviewVersionOf({
      revision: 1,
      review: null,
    });

    expect(version?.expectedLatestReviewId).toBeNull();

    expect(JSON.parse(JSON.stringify(version))).toEqual({
      expectedRevision: 1,
      expectedLatestReviewId: null,
    });
  });

  it('제출본 번호가 없는 칸에서는 아무 값도 지어내지 않는다', () => {
    expect(
      milestoneDocumentReviewVersionOf({ revision: null, review: null }),
    ).toBeNull();
  });

  it('1보다 작은 번호는 실어 보내지 않는다', () => {
    expect(
      milestoneDocumentReviewVersionOf({ revision: 0, review: null }),
    ).toBeNull();
    expect(
      milestoneDocumentReviewVersionOf({ revision: -1, review: null }),
    ).toBeNull();
  });

  it('첫 제출(1)은 그대로 실어 보낸다', () => {
    expect(
      milestoneDocumentReviewVersionOf({ revision: 1, review: null })
        ?.expectedRevision,
    ).toBe(1);
  });
});

describe('milestoneDocumentReviewVersionError', () => {
  it('버전을 떠 왔으면 막지 않는다', () => {
    expect(
      milestoneDocumentReviewVersionError({
        expectedRevision: 1,
        expectedLatestReviewId: null,
      }),
    ).toBeNull();
  });

  it('버전이 없으면 표를 다시 부르라고 말한다', () => {
    expect(milestoneDocumentReviewVersionError(null)).toBe(
      '이 칸의 제출 정보를 읽지 못해 검토할 수 없습니다. 표를 다시 불러 주세요.',
    );
  });
});

describe('nextMilestoneDocumentReviewState', () => {
  const target = { teamId: 'a1', documentId: 'd1' };
  const version = {
    expectedRevision: 1,
    expectedLatestReviewId: null,
  };

  it('닫혀 있으면 그 칸을 연다', () => {
    expect(nextMilestoneDocumentReviewState(null, target, version)).toEqual({
      target,
      version,
      decision: null,
      comment: '',
      isSubmitting: false,
      errorMessage: null,
      history: [],
      historyNextCursor: null,
      historyIsComplete: true,
      isHistoryLoading: true,
      historyError: null,
    });
  });

  it('같은 칸을 다시 누르면 닫는다', () => {
    const open = createMilestoneDocumentReviewFormState(target, version);
    expect(nextMilestoneDocumentReviewState(open, target, version)).toBeNull();
  });

  it('다른 칸으로 옮기면 적어 둔 사유와 판정을 가져가지 않는다', () => {
    const open = {
      ...createMilestoneDocumentReviewFormState(target, version),
      decision: 'REJECTED' as const,
      comment: '가팀에 적던 지적',
    };
    const next = nextMilestoneDocumentReviewState(
      open,
      { teamId: 'a2', documentId: 'd1' },
      {
        expectedRevision: 3,
        expectedLatestReviewId: 'review-2',
      },
    );

    expect(next).not.toBeNull();
    expect(next?.target).toEqual({ teamId: 'a2', documentId: 'd1' });
    expect(next?.comment).toBe('');
    expect(next?.decision).toBeNull();

    expect(next?.version).toEqual({
      expectedRevision: 3,
      expectedLatestReviewId: 'review-2',
    });
  });
});

describe('isSameMilestoneDocumentReviewTarget', () => {
  it('팀과 서류가 둘 다 같아야 같은 칸이다', () => {
    expect(
      isSameMilestoneDocumentReviewTarget(
        { teamId: 'a1', documentId: 'd1' },
        { teamId: 'a1', documentId: 'd1' },
      ),
    ).toBe(true);
    expect(
      isSameMilestoneDocumentReviewTarget(
        { teamId: 'a1', documentId: 'd1' },
        { teamId: 'a1', documentId: 'd2' },
      ),
    ).toBe(false);
    expect(
      isSameMilestoneDocumentReviewTarget(
        { teamId: 'a1', documentId: 'd1' },
        { teamId: 'a2', documentId: 'd1' },
      ),
    ).toBe(false);
  });
});
