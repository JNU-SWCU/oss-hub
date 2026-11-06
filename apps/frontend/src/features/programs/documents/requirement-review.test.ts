import { describe, expect, it } from 'vitest';
import type {
  RequirementSubmissionStatus,
  RequirementViewerSubmission,
} from './requirement-dto';
import type { RequirementCollectionCell } from './requirement-collection-dto';
import {
  createRequirementReviewFormState,
  isRequirementDeadlineLocked,
  isRequirementResubmissionFinal,
  isRequirementResubmittable,
  isSameRequirementReviewTarget,
  REQUIREMENT_REVIEW_DECISION_ORDER,
  REQUIREMENT_REVIEW_DISPLAY_LABELS,
  REQUIREMENT_REVIEW_DISPLAY_VARIANTS,
  requirementCellDisplay,
  requirementReviewCommentPayload,
  requirementReviewFormError,
  requirementReviewNoticeTone,
  requirementReviewVersionError,
  requirementReviewVersionOf,
  requirementViewerDisplay,
  nextRequirementReviewState,
  shouldHighlightRequirementReview,
} from './requirement-review';

function viewer(
  overrides: Partial<RequirementViewerSubmission> = {},
): RequirementViewerSubmission {
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

describe('requirementCellDisplay', () => {
  it('미제출은 상태를 보기 전에 미제출이다', () => {
    expect(requirementCellDisplay({ isSubmitted: false, status: null })).toBe(
      'NOT_SUBMITTED',
    );
  });

  it('미제출 칸에 상태가 실려 와도 미제출로 읽는다', () => {
    expect(
      requirementCellDisplay({
        isSubmitted: false,
        status: 'APPROVED',
      }),
    ).toBe('NOT_SUBMITTED');
  });

  it('냈지만 아무도 보지 않았으면 검토 대기다', () => {
    expect(
      requirementCellDisplay({ isSubmitted: true, status: 'SUBMITTED' }),
    ).toBe('PENDING');
  });

  it('상태가 비어 와도 낸 칸은 검토 대기다', () => {
    expect(requirementCellDisplay({ isSubmitted: true, status: null })).toBe(
      'PENDING',
    );
  });

  it('판정이 옮겨 놓은 상태는 그대로 말한다', () => {
    for (const decision of REQUIREMENT_REVIEW_DECISION_ORDER) {
      expect(
        requirementCellDisplay({ isSubmitted: true, status: decision }),
      ).toBe(decision);
    }
  });

  it('다시 낸 칸은 지난 보완 요청이 남아 있어도 검토 대기다', () => {
    const resubmitted: RequirementCollectionCell = {
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

    expect(requirementCellDisplay(resubmitted)).toBe('PENDING');
  });
});

describe('requirementViewerDisplay', () => {
  it('교직원 뷰(값 없음)와 미제출은 둘 다 미제출이다', () => {
    expect(requirementViewerDisplay(undefined)).toBe('NOT_SUBMITTED');
    expect(
      requirementViewerDisplay(
        viewer({ submitted: false, submittedAt: null, status: null }),
      ),
    ).toBe('NOT_SUBMITTED');
  });

  it('제출됨은 제출본 번호와 무관하게 검토 대기다', () => {
    for (const revision of [1, 2, 7]) {
      expect(
        requirementViewerDisplay(viewer({ status: 'SUBMITTED', revision })),
      ).toBe('PENDING');
    }
  });

  it('판정 상태는 그대로 말한다', () => {
    const statuses: readonly RequirementSubmissionStatus[] = [
      'APPROVED',
      'CHANGES_REQUESTED',
      'REJECTED',
    ];
    for (const status of statuses) {
      expect(requirementViewerDisplay(viewer({ status }))).toBe(status);
    }
  });
});

describe('배지 표', () => {
  it('다섯 갈래를 이 말로 부른다', () => {
    expect(REQUIREMENT_REVIEW_DISPLAY_LABELS).toEqual({
      NOT_SUBMITTED: '미제출',
      PENDING: '검토 대기',
      APPROVED: '승인',
      CHANGES_REQUESTED: '보완 요청',
      REJECTED: '반려',
    });
  });

  it('다섯 갈래의 색이 서로 겹치지 않는다', () => {
    const variants = Object.values(REQUIREMENT_REVIEW_DISPLAY_VARIANTS);
    expect(new Set(variants).size).toBe(5);
  });

  it('전부 기존 StatusBadge 변형이다', () => {
    const known = ['recruiting', 'closed', 'pending', 'approved', 'rejected'];
    for (const variant of Object.values(REQUIREMENT_REVIEW_DISPLAY_VARIANTS)) {
      expect(known).toContain(variant);
    }
  });
});

describe('isRequirementResubmittable', () => {
  it('승인·반려는 막는다', () => {
    expect(isRequirementResubmittable(viewer({ status: 'APPROVED' }))).toBe(
      false,
    );
    expect(isRequirementResubmittable(viewer({ status: 'REJECTED' }))).toBe(
      false,
    );
  });

  it('보완 요청은 연다', () => {
    expect(
      isRequirementResubmittable(viewer({ status: 'CHANGES_REQUESTED' })),
    ).toBe(true);
  });

  it('미제출과 검토 대기는 연다', () => {
    expect(
      isRequirementResubmittable(
        viewer({ submitted: false, submittedAt: null, status: null }),
      ),
    ).toBe(true);
    expect(isRequirementResubmittable(viewer({ status: 'SUBMITTED' }))).toBe(
      true,
    );
    expect(isRequirementResubmittable(undefined)).toBe(true);
  });
});

describe('isRequirementDeadlineLocked', () => {
  it.each([
    [false, 'SUBMITTED', false],
    [true, 'SUBMITTED', true],
    [true, 'APPROVED', true],
    [true, 'REJECTED', true],
    [true, 'CHANGES_REQUESTED', false],
  ] as const)(
    'closed=%s, status=%s preserves the milestone cutoff (%s)',
    (closed, status, locked) => {
      expect(isRequirementDeadlineLocked(closed, viewer({ status }))).toBe(
        locked,
      );
    },
  );
  it('keeps a changes request open after the milestone deadline', () => {
    expect(
      isRequirementDeadlineLocked(
        true,
        viewer({
          status: 'CHANGES_REQUESTED',
          review: { comment: null, reviewedAt: '2026-08-01T00:00:00Z' },
        }),
      ),
    ).toBe(false);
  });
});

describe('isRequirementResubmissionFinal', () => {
  it('마감 뒤 아직 응하지 않은 보완 요청에서만 참이다', () => {
    expect(
      isRequirementResubmissionFinal(
        true,
        viewer({ status: 'CHANGES_REQUESTED' }),
      ),
    ).toBe(true);
    expect(
      isRequirementResubmissionFinal(
        false,
        viewer({ status: 'CHANGES_REQUESTED' }),
      ),
    ).toBe(false);
    for (const status of ['SUBMITTED', 'APPROVED', 'REJECTED'] as const) {
      expect(isRequirementResubmissionFinal(true, viewer({ status }))).toBe(
        false,
      );
    }
    expect(isRequirementResubmissionFinal(true, undefined)).toBe(false);
  });
});

describe('shouldHighlightRequirementReview', () => {
  it('보완 요청·반려만 경고 톤으로 키운다', () => {
    expect(shouldHighlightRequirementReview('CHANGES_REQUESTED')).toBe(true);
    expect(shouldHighlightRequirementReview('REJECTED')).toBe(true);
    expect(shouldHighlightRequirementReview('APPROVED')).toBe(false);
    expect(shouldHighlightRequirementReview('PENDING')).toBe(false);
    expect(shouldHighlightRequirementReview('NOT_SUBMITTED')).toBe(false);
  });
});

describe('requirementReviewNoticeTone', () => {
  it('보완 요청·반려는 사유 유무와 무관하게 경고 톤이다', () => {
    expect(
      requirementReviewNoticeTone('CHANGES_REQUESTED', '표지를 고쳐 주세요.'),
    ).toBe('warning');
    expect(requirementReviewNoticeTone('REJECTED', '기한을 넘겼습니다.')).toBe(
      'warning',
    );

    expect(requirementReviewNoticeTone('CHANGES_REQUESTED', null)).toBe(
      'warning',
    );
    expect(requirementReviewNoticeTone('REJECTED', null)).toBe('warning');
  });

  it('사유를 적은 승인은 중립 톤으로 보여 준다', () => {
    expect(
      requirementReviewNoticeTone(
        'APPROVED',
        '잘 받았습니다. 다음 단계를 안내드릴게요.',
      ),
    ).toBe('neutral');
  });

  it('사유 없는 승인에는 상자를 세우지 않는다', () => {
    expect(requirementReviewNoticeTone('APPROVED', null)).toBeNull();
    expect(requirementReviewNoticeTone('APPROVED', '   ')).toBeNull();
  });

  it('검토 대기·미제출에는 그리지 않는다', () => {
    expect(requirementReviewNoticeTone('PENDING', '지난 지적')).toBeNull();
    expect(
      requirementReviewNoticeTone('NOT_SUBMITTED', '지난 지적'),
    ).toBeNull();
  });
});

describe('requirementReviewFormError', () => {
  it('requires a decision', () => {
    expect(requirementReviewFormError(null, '')).not.toBeNull();
  });
  it.each(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'] as const)(
    '%s accepts no reason or deadline while enforcing the comment limit',
    (decision) => {
      expect(requirementReviewFormError(decision, '')).toBeNull();
      expect(requirementReviewFormError(decision, '  \n\t')).toBeNull();
      expect(requirementReviewFormError(decision, 'x'.repeat(2000))).toBeNull();
      expect(
        requirementReviewFormError(decision, 'x'.repeat(2001)),
      ).not.toBeNull();
    },
  );
});

describe('requirementReviewCommentPayload', () => {
  it('앞뒤 공백을 떼어 보낸다', () => {
    expect(requirementReviewCommentPayload('  고쳐 주세요.  ')).toBe(
      '고쳐 주세요.',
    );
  });

  it('공백만 남으면 아예 싣지 않는다', () => {
    expect(requirementReviewCommentPayload('   ')).toBeUndefined();
    expect(requirementReviewCommentPayload('')).toBeUndefined();
  });
});

describe('requirementReviewVersionOf', () => {
  it('칸의 제출본 번호와 최신 판정 id를 그대로 뜬다', () => {
    expect(
      requirementReviewVersionOf({
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
    const version = requirementReviewVersionOf({
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
      requirementReviewVersionOf({ revision: null, review: null }),
    ).toBeNull();
  });

  it('1보다 작은 번호는 실어 보내지 않는다', () => {
    expect(
      requirementReviewVersionOf({ revision: 0, review: null }),
    ).toBeNull();
    expect(
      requirementReviewVersionOf({ revision: -1, review: null }),
    ).toBeNull();
  });

  it('첫 제출(1)은 그대로 실어 보낸다', () => {
    expect(
      requirementReviewVersionOf({ revision: 1, review: null })
        ?.expectedRevision,
    ).toBe(1);
  });
});

describe('requirementReviewVersionError', () => {
  it('버전을 떠 왔으면 막지 않는다', () => {
    expect(
      requirementReviewVersionError({
        expectedRevision: 1,
        expectedLatestReviewId: null,
      }),
    ).toBeNull();
  });

  it('버전이 없으면 표를 다시 부르라고 말한다', () => {
    expect(requirementReviewVersionError(null)).toBe(
      '이 칸의 제출 정보를 읽지 못해 검토할 수 없습니다. 표를 다시 불러 주세요.',
    );
  });
});

describe('nextRequirementReviewState', () => {
  const target = { teamId: 'a1', documentId: 'd1' };
  const version = {
    expectedRevision: 1,
    expectedLatestReviewId: null,
  };

  it('닫혀 있으면 그 칸을 연다', () => {
    expect(nextRequirementReviewState(null, target, version)).toEqual({
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
    const open = createRequirementReviewFormState(target, version);
    expect(nextRequirementReviewState(open, target, version)).toBeNull();
  });

  it('다른 칸으로 옮기면 적어 둔 사유와 판정을 가져가지 않는다', () => {
    const open = {
      ...createRequirementReviewFormState(target, version),
      decision: 'REJECTED' as const,
      comment: '가팀에 적던 지적',
    };
    const next = nextRequirementReviewState(
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

describe('isSameRequirementReviewTarget', () => {
  it('팀과 서류가 둘 다 같아야 같은 칸이다', () => {
    expect(
      isSameRequirementReviewTarget(
        { teamId: 'a1', documentId: 'd1' },
        { teamId: 'a1', documentId: 'd1' },
      ),
    ).toBe(true);
    expect(
      isSameRequirementReviewTarget(
        { teamId: 'a1', documentId: 'd1' },
        { teamId: 'a1', documentId: 'd2' },
      ),
    ).toBe(false);
    expect(
      isSameRequirementReviewTarget(
        { teamId: 'a1', documentId: 'd1' },
        { teamId: 'a2', documentId: 'd1' },
      ),
    ).toBe(false);
  });
});
