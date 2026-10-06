import { afterEach, describe, expect, it } from 'vitest';
import type {
  MilestoneDocumentSubmissionStatus,
  MilestoneDocumentViewerSubmission,
} from './milestone-document-api';
import type { MilestoneDocumentCollectionCell } from './milestone-document-collection-api';
import {
  createMilestoneDocumentReviewFormState,
  isMilestoneDocumentDeadlineLocked,
  isMilestoneDocumentResubmissionFinal,
  isMilestoneDocumentResubmittable,
  isMilestoneDocumentReviewCommentRequired,
  isSameMilestoneDocumentReviewTarget,
  MILESTONE_DOCUMENT_REVIEW_DECISION_ORDER,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS,
  milestoneDocumentCellDisplay,
  milestoneDocumentResubmissionDueAtError,
  milestoneDocumentResubmissionDueAtPayload,
  milestoneDocumentResubmissionDueNotice,
  milestoneDocumentResubmissionDueTickDelay,
  milestoneDocumentReviewCommentPayload,
  milestoneDocumentReviewFormError,
  milestoneDocumentReviewNoticeTone,
  milestoneDocumentReviewVersionError,
  milestoneDocumentReviewVersionOf,
  milestoneDocumentViewerDisplay,
  nextMilestoneDocumentReviewState,
  shouldHighlightMilestoneDocumentReview,
} from './milestone-document-review';
import { MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH } from './milestone-document-review-api';

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
        resubmissionDueAt: null,
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
  it('마감 전에는 아무것도 잠그지 않는다', () => {
    for (const status of [
      null,
      'SUBMITTED',
      'APPROVED',
      'CHANGES_REQUESTED',
      'REJECTED',
    ] as const) {
      expect(isMilestoneDocumentDeadlineLocked(false, viewer({ status }))).toBe(
        false,
      );
    }
    expect(isMilestoneDocumentDeadlineLocked(false, undefined)).toBe(false);
  });

  it('마감 뒤에도 보완 요청은 지나간다', () => {
    expect(
      isMilestoneDocumentDeadlineLocked(
        true,
        viewer({ status: 'CHANGES_REQUESTED' }),
      ),
    ).toBe(false);
  });

  it('마감 뒤 나머지 상태는 그대로 잠근다', () => {
    for (const status of [null, 'SUBMITTED', 'APPROVED', 'REJECTED'] as const) {
      expect(isMilestoneDocumentDeadlineLocked(true, viewer({ status }))).toBe(
        true,
      );
    }
    expect(isMilestoneDocumentDeadlineLocked(true, undefined)).toBe(true);
  });

  it('마감 뒤, 보완 요청에 이미 응한 제출은 잠근 채로 둔다', () => {
    expect(
      isMilestoneDocumentDeadlineLocked(
        true,
        viewer({
          status: 'SUBMITTED',
          revision: 2,
          review: {
            comment: '3쪽 서명이 빠졌습니다.',
            reviewedAt: '2026-08-02T00:00:00.000Z',
            resubmissionDueAt: null,
          },
        }),
      ),
    ).toBe(true);
  });

  it('마감 전이면 재제출도 잠기지 않는다', () => {
    expect(
      isMilestoneDocumentDeadlineLocked(
        false,
        viewer({ status: 'SUBMITTED', revision: 2 }),
      ),
    ).toBe(false);
  });

  it.each([
    [false, null, null, true],
    [false, 'SUBMITTED', 1, true],
    [false, 'CHANGES_REQUESTED', 1, true],
    [false, 'SUBMITTED', 2, true],
    [false, 'APPROVED', 1, false],
    [false, 'REJECTED', 1, false],
    [true, null, null, false],
    [true, 'SUBMITTED', 1, false],
    [true, 'CHANGES_REQUESTED', 1, true],
    [true, 'SUBMITTED', 2, false],
    [true, 'APPROVED', 1, false],
    [true, 'REJECTED', 1, false],
  ] as const)(
    '마감 지남=%s · 상태=%s · 리비전=%s 에서 조작 가능 여부는 %s다',
    (closed, status, revision, opens) => {
      const viewerSubmission =
        status === null
          ? viewer({ submitted: false, submittedAt: null, status, revision })
          : viewer({ status, revision });

      const editable =
        isMilestoneDocumentResubmittable(viewerSubmission) &&
        !isMilestoneDocumentDeadlineLocked(closed, viewerSubmission);

      expect(editable).toBe(opens);
    },
  );

  const dueAt = '2026-09-26T09:00:00.000Z';
  const beforeDue = Date.parse('2026-09-26T08:59:59.999Z');
  const afterDue = Date.parse('2026-09-26T09:00:00.001Z');
  function awaitingResubmission(
    resubmissionDueAt: string | null,
  ): MilestoneDocumentViewerSubmission {
    return viewer({
      status: 'CHANGES_REQUESTED',
      review: {
        comment: '3쪽 서명이 빠졌습니다.',
        reviewedAt: '2026-09-20T00:00:00.000Z',
        resubmissionDueAt,
      },
    });
  }

  it('재제출 기한이 남아 있으면 마감 뒤에도 연다', () => {
    expect(
      isMilestoneDocumentDeadlineLocked(
        true,
        awaitingResubmission(dueAt),
        beforeDue,
      ),
    ).toBe(false);
  });

  it('재제출 기한이 지나면 아직 응하지 않은 보완 요청도 잠근다', () => {
    expect(
      isMilestoneDocumentDeadlineLocked(
        true,
        awaitingResubmission(dueAt),
        afterDue,
      ),
    ).toBe(true);
  });

  it('기한이 없는 옛 보완 요청은 앞 규칙대로 연다', () => {
    expect(
      isMilestoneDocumentDeadlineLocked(
        true,
        awaitingResubmission(null),
        afterDue,
      ),
    ).toBe(false);
  });

  it('마감 전에는 기한이 지났어도 잠그지 않는다', () => {
    expect(
      isMilestoneDocumentDeadlineLocked(
        false,
        awaitingResubmission(dueAt),
        afterDue,
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

describe('milestoneDocumentResubmissionDueNotice', () => {
  const dueAt = '2026-09-26T09:00:00.000Z';
  function withDue(
    status: MilestoneDocumentSubmissionStatus,
    resubmissionDueAt: string | null,
  ): MilestoneDocumentViewerSubmission {
    return viewer({
      status,
      review: {
        comment: '3쪽 서명이 빠졌습니다.',
        reviewedAt: '2026-09-20T00:00:00.000Z',
        resubmissionDueAt,
      },
    });
  }

  it('아직 응하지 않았고 기한이 남았으면 언제까지인지 말한다', () => {
    expect(
      milestoneDocumentResubmissionDueNotice(
        withDue('CHANGES_REQUESTED', dueAt),
        Date.parse('2026-09-26T08:59:59.999Z'),
      ),
    ).toEqual({ kind: 'open', dueAt });
  });

  it('기한이 지났으면 지났다고 말한다', () => {
    expect(
      milestoneDocumentResubmissionDueNotice(
        withDue('CHANGES_REQUESTED', dueAt),
        Date.parse('2026-09-26T09:00:00.001Z'),
      ),
    ).toEqual({ kind: 'passed', dueAt });
  });

  it('이미 다시 낸 서류에는 아무 말도 하지 않는다', () => {
    expect(
      milestoneDocumentResubmissionDueNotice(
        withDue('SUBMITTED', dueAt),
        Date.parse('2026-09-26T08:59:59.999Z'),
      ),
    ).toBeNull();
  });

  it('기한 없는 옛 보완 요청에는 없는 기한을 지어내지 않는다', () => {
    expect(
      milestoneDocumentResubmissionDueNotice(
        withDue('CHANGES_REQUESTED', null),
        Date.parse('2026-09-26T09:00:00.001Z'),
      ),
    ).toBeNull();
  });
});

describe('milestoneDocumentResubmissionDueAtError', () => {
  const now = Date.parse('2026-09-20T00:00:00.000Z');

  it('보완 요청에 기한이 없으면 저장할 수 없다', () => {
    expect(
      milestoneDocumentResubmissionDueAtError('CHANGES_REQUESTED', '', now),
    ).toBe('보완 요청은 재제출 기한을 정해 주세요.');
  });

  it('지난 시각은 거절하고 무엇을 고칠지 말한다', () => {
    expect(
      milestoneDocumentResubmissionDueAtError(
        'CHANGES_REQUESTED',
        '2026-09-19T23:59',
        now,
      ),
    ).toBe('재제출 기한은 지금보다 뒤여야 합니다.');
  });

  it('읽을 수 없는 값은 다시 고르라고 말한다', () => {
    expect(
      milestoneDocumentResubmissionDueAtError(
        'CHANGES_REQUESTED',
        '2026-02-30T25:61',
        now,
      ),
    ).toBe('재제출 기한을 다시 골라 주세요.');
  });

  it('미래 시각이면 통과한다', () => {
    expect(
      milestoneDocumentResubmissionDueAtError(
        'CHANGES_REQUESTED',
        '2026-09-26T18:00',
        now,
      ),
    ).toBeNull();
  });

  it('승인·반려는 기한을 보지 않는다', () => {
    expect(
      milestoneDocumentResubmissionDueAtError('APPROVED', '', now),
    ).toBeNull();
    expect(
      milestoneDocumentResubmissionDueAtError('REJECTED', '', now),
    ).toBeNull();
  });
});

describe('milestoneDocumentResubmissionDueAtPayload', () => {
  it('보완 요청의 서울 시각을 ISO로 굳혀 보낸다', () => {
    expect(
      milestoneDocumentResubmissionDueAtPayload(
        'CHANGES_REQUESTED',
        '2026-09-26T18:00',
      ),
    ).toBe('2026-09-26T09:00:00.000Z');
  });

  it('승인·반려에는 아예 싣지 않는다', () => {
    expect(
      milestoneDocumentResubmissionDueAtPayload('APPROVED', '2026-09-26T18:00'),
    ).toBeUndefined();
    expect(
      milestoneDocumentResubmissionDueAtPayload('REJECTED', '2026-09-26T18:00'),
    ).toBeUndefined();
  });

  it('읽을 수 없는 값은 지어내지 않고 빼고 보낸다', () => {
    expect(
      milestoneDocumentResubmissionDueAtPayload('CHANGES_REQUESTED', ''),
    ).toBeUndefined();
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

describe('isMilestoneDocumentReviewCommentRequired', () => {
  it('보완 요청·반려만 사유가 필요하다', () => {
    expect(isMilestoneDocumentReviewCommentRequired('CHANGES_REQUESTED')).toBe(
      true,
    );
    expect(isMilestoneDocumentReviewCommentRequired('REJECTED')).toBe(true);
    expect(isMilestoneDocumentReviewCommentRequired('APPROVED')).toBe(false);
  });
});

describe('milestoneDocumentReviewFormError', () => {
  it('판정을 고르기 전에는 저장할 수 없다', () => {
    expect(milestoneDocumentReviewFormError(null, '무엇이든')).toBe(
      '승인, 보완 요청, 반려 중 하나를 골라 주세요.',
    );
  });

  it('보완 요청·반려에 사유가 비면 막는다', () => {
    expect(milestoneDocumentReviewFormError('CHANGES_REQUESTED', '')).toBe(
      '보완 요청과 반려는 사유를 입력해 주세요.',
    );
    expect(milestoneDocumentReviewFormError('REJECTED', '')).toBe(
      '보완 요청과 반려는 사유를 입력해 주세요.',
    );
  });

  it('공백만 적은 사유는 안 적은 것으로 본다', () => {
    expect(milestoneDocumentReviewFormError('REJECTED', '   \n\t  ')).toBe(
      '보완 요청과 반려는 사유를 입력해 주세요.',
    );
  });

  it('승인은 사유 없이도 저장할 수 있다', () => {
    expect(milestoneDocumentReviewFormError('APPROVED', '')).toBeNull();
  });

  it('사유를 적어도 재제출 기한이 없는 보완 요청은 막는다', () => {
    expect(
      milestoneDocumentReviewFormError(
        'CHANGES_REQUESTED',
        '표지를 고쳐 주세요.',
      ),
    ).toBe('보완 요청은 재제출 기한을 정해 주세요.');
  });

  it('사유와 재제출 기한을 함께 채운 보완 요청은 저장할 수 있다', () => {
    expect(
      milestoneDocumentReviewFormError(
        'CHANGES_REQUESTED',
        '표지를 고쳐 주세요.',
        '2026-09-26T18:00',
        Date.parse('2026-09-20T00:00:00.000Z'),
      ),
    ).toBeNull();
  });

  it('사유와 기한이 둘 다 비면 사유를 먼저 말한다', () => {
    expect(milestoneDocumentReviewFormError('CHANGES_REQUESTED', '')).toBe(
      '보완 요청과 반려는 사유를 입력해 주세요.',
    );
  });

  it('한도를 넘긴 사유는 막는다', () => {
    const tooLong = 'ㄱ'.repeat(
      MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH + 1,
    );
    expect(milestoneDocumentReviewFormError('APPROVED', tooLong)).toBe(
      '사유는 2,000자까지 쓸 수 있습니다.',
    );
    expect(
      milestoneDocumentReviewFormError(
        'APPROVED',
        'ㄱ'.repeat(MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH),
      ),
    ).toBeNull();
  });
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
          resubmissionDueAt: null,
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
  const target = { applicationId: 'a1', documentId: 'd1' };
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
      resubmissionDueAt: '',
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
      { applicationId: 'a2', documentId: 'd1' },
      {
        expectedRevision: 3,
        expectedLatestReviewId: 'review-2',
      },
    );

    expect(next).not.toBeNull();
    expect(next?.target).toEqual({ applicationId: 'a2', documentId: 'd1' });
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
        { applicationId: 'a1', documentId: 'd1' },
        { applicationId: 'a1', documentId: 'd1' },
      ),
    ).toBe(true);
    expect(
      isSameMilestoneDocumentReviewTarget(
        { applicationId: 'a1', documentId: 'd1' },
        { applicationId: 'a1', documentId: 'd2' },
      ),
    ).toBe(false);
    expect(
      isSameMilestoneDocumentReviewTarget(
        { applicationId: 'a1', documentId: 'd1' },
        { applicationId: 'a2', documentId: 'd1' },
      ),
    ).toBe(false);
  });
});

describe('재제출 기한을 서울 시각으로 읽는다', () => {
  const originalTimeZone = process.env.TZ;

  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  it('UTC 브라우저가 고른 18:00도 서울 18:00으로 보낸다', () => {
    process.env.TZ = 'UTC';

    expect(
      milestoneDocumentResubmissionDueAtPayload(
        'CHANGES_REQUESTED',
        '2026-09-26T18:00',
      ),
    ).toBe('2026-09-26T09:00:00.000Z');
  });

  it('서울에서 12시간 앞선 곳에서도 같은 값을 보낸다', () => {
    process.env.TZ = 'Pacific/Auckland';

    expect(
      milestoneDocumentResubmissionDueAtPayload(
        'CHANGES_REQUESTED',
        '2026-09-26T18:00',
      ),
    ).toBe('2026-09-26T09:00:00.000Z');
  });

  it('검사도 같은 규칙으로 읽어 지난 시각을 그 자리에서 막는다', () => {
    process.env.TZ = 'UTC';

    const now = Date.parse('2026-09-26T09:30:00.000Z');

    expect(
      milestoneDocumentResubmissionDueAtError(
        'CHANGES_REQUESTED',
        '2026-09-26T18:00',
        now,
      ),
    ).toBe('재제출 기한은 지금보다 뒤여야 합니다.');
  });
});

describe('milestoneDocumentResubmissionDueTickDelay', () => {
  const dueAt = '2026-09-26T09:00:00.000Z';

  function awaitingResubmission(
    resubmissionDueAt: string | null,
  ): MilestoneDocumentViewerSubmission {
    return viewer({
      status: 'CHANGES_REQUESTED',
      review: {
        comment: '3쪽 서명이 빠졌습니다.',
        reviewedAt: '2026-09-20T00:00:00.000Z',
        resubmissionDueAt,
      },
    });
  }

  it('기한이 지나는 순간 다음 1밀리초를 겨냥한다', () => {
    const now = Date.parse('2026-09-26T08:59:59.000Z');

    expect(
      milestoneDocumentResubmissionDueTickDelay(
        awaitingResubmission(dueAt),
        now,
      ),
    ).toBe(1001);
  });

  it('이미 지난 기한·기한 없는 옛 보완 요청에는 타이머를 걸지 않는다', () => {
    const afterDue = Date.parse('2026-09-26T09:00:00.001Z');

    expect(
      milestoneDocumentResubmissionDueTickDelay(
        awaitingResubmission(dueAt),
        afterDue,
      ),
    ).toBeNull();
    expect(
      milestoneDocumentResubmissionDueTickDelay(
        awaitingResubmission(null),
        afterDue,
      ),
    ).toBeNull();
  });

  it('보완 요청을 기다리는 자리가 아니면 타이머를 걸지 않는다', () => {
    const now = Date.parse('2026-09-26T08:00:00.000Z');

    for (const status of ['SUBMITTED', 'APPROVED', 'REJECTED'] as const) {
      expect(
        milestoneDocumentResubmissionDueTickDelay(viewer({ status }), now),
      ).toBeNull();
    }
  });

  it('setTimeout이 감당하는 최대치를 넘지 않는다', () => {
    const now = Date.parse('2026-09-26T09:00:00.000Z');
    const farFuture = viewer({
      status: 'CHANGES_REQUESTED',
      review: {
        comment: '3쪽 서명이 빠졌습니다.',
        reviewedAt: '2026-09-20T00:00:00.000Z',
        resubmissionDueAt: '2027-09-26T09:00:00.000Z',
      },
    });

    expect(milestoneDocumentResubmissionDueTickDelay(farFuture, now)).toBe(
      2_147_483_647,
    );
  });
});
