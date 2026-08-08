import { describe, expect, it } from 'vitest';
import type {
  MilestoneDocumentSubmissionStatus,
  MilestoneDocumentViewerSubmission,
} from './milestone-document-api';
import type { MilestoneDocumentCollectionCell } from './milestone-document-collection-api';
import {
  createMilestoneDocumentReviewFormState,
  isMilestoneDocumentDeadlineLocked,
  isMilestoneDocumentResubmittable,
  isMilestoneDocumentReviewCommentRequired,
  isSameMilestoneDocumentReviewTarget,
  MILESTONE_DOCUMENT_REVIEW_DECISION_ORDER,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS,
  milestoneDocumentCellDisplay,
  milestoneDocumentReviewCommentPayload,
  milestoneDocumentReviewFormError,
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
    status: 'SUBMITTED',
    review: null,
    ...overrides,
  };
}

describe('milestoneDocumentCellDisplay', () => {
  it('미제출은 상태를 보기 전에 미제출이다', () => {
    expect(
      milestoneDocumentCellDisplay({ isSubmitted: false, status: null }),
    ).toBe('NOT_SUBMITTED');
  });

  /**
   * 계약상 미제출 칸에는 상태가 실리지 않지만, 어긋난 응답 한 건이 「안 낸 팀이 승인됨」
   * 으로 보이면 교직원은 그 팀을 독촉 대상에서 뺀다. 순서를 뒤집지 마라.
   */
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

  // 제출은 있는데 상태만 비어 온 응답에서 「미제출」이라고 말하면 그 건을 아무도 안 본다.
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

  /**
   * 여기가 이 함수의 요점이다. 보완 요청을 받아 **다시 낸** 칸은 상태만 `SUBMITTED`로
   * 돌아오고 판정 기록은 그대로 남는다. 배지를 `review.decision`으로 되돌리면 그 칸이
   * 계속 「보완 요청」으로 보여, 교직원이 다시 검토해야 할 건을 처리 끝난 것으로 읽는다.
   *
   * 칸을 **통째로** 넘긴다 — 판정이 실제로 손에 있는데도 무시하는지를 물어야 하기
   * 때문이다. 상태만 넘겨서는 그 함수가 판정을 안 본다는 것을 확인할 수 없다.
   */
  it('다시 낸 칸은 지난 보완 요청이 남아 있어도 검토 대기다', () => {
    const resubmitted: MilestoneDocumentCollectionCell = {
      documentId: 'd1',
      isSubmitted: true,
      status: 'SUBMITTED',
      submittedAt: '2026-08-03T00:00:00.000Z',
      file: null,
      review: {
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

  /**
   * 재제출이 상태를 SUBMITTED로 되돌린다. 보완 요청을 받아 다시 낸 학생에게 계속
   * 「보완 요청」이라고 말하면 안 낸 것처럼 읽힌다.
   */
  it('제출됨은 검토 대기로 접는다', () => {
    expect(
      milestoneDocumentViewerDisplay(viewer({ status: 'SUBMITTED' })),
    ).toBe('PENDING');
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
  it('다섯 갈래에 다섯 라벨이 붙는다', () => {
    expect(MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS).toEqual({
      NOT_SUBMITTED: '미제출',
      PENDING: '검토 대기',
      APPROVED: '승인',
      CHANGES_REQUESTED: '보완 요청',
      REJECTED: '반려',
    });
  });

  /**
   * 「아직 안 본 것」과 「되돌려 보낸 것」이 같은 색이면 독촉 대상을 눈으로 고를 수 없다.
   * 색 자체가 아니라 **다섯이 서로 다르다**는 것을 고정한다.
   */
  it('다섯 갈래의 색이 서로 겹치지 않는다', () => {
    const variants = Object.values(MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS);
    expect(new Set(variants).size).toBe(5);
  });

  // 새 색을 발명하면 여기서 걸린다 — StatusBadge가 아는 변형은 이 다섯뿐이다.
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

  /**
   * 미제출(첫 제출)과 검토 대기(끝난 판정 없음)도 열려 있어야 한다. 「보완 요청일 때만」
   * 으로 좁히면 아직 아무도 안 본 제출을 마감 전에 고칠 수 없게 되는데, 그것은 지금
   * 되는 일을 하나 없애는 것이다.
   */
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

  /**
   * 마감 뒤에 「고쳐서 다시 내세요」라고 하는 것은 흔한 일이다. 화면이 여기까지 잠그면
   * 교직원이 요청한 재제출을 학생이 낼 수 없어 그 요청 자체가 뜻을 잃는다 — 서버는 받는다.
   */
  it('마감 뒤에도 보완 요청은 지나간다', () => {
    expect(
      isMilestoneDocumentDeadlineLocked(
        true,
        viewer({ status: 'CHANGES_REQUESTED' }),
      ),
    ).toBe(false);
  });

  /**
   * 나머지는 마감이 잠근다. 미제출·검토 대기까지 풀면 마감이 아무것도 막지 않는 표시가
   * 된다. 승인·반려는 여기서 풀려도 `isMilestoneDocumentResubmittable`이 막지만, 마감
   * 판정 자체가 흐트러지면 그 겹침을 믿고 한쪽을 지웠을 때 조용히 뚫린다.
   */
  it('마감 뒤 나머지 상태는 그대로 잠근다', () => {
    for (const status of [null, 'SUBMITTED', 'APPROVED', 'REJECTED'] as const) {
      expect(isMilestoneDocumentDeadlineLocked(true, viewer({ status }))).toBe(
        true,
      );
    }
    expect(isMilestoneDocumentDeadlineLocked(true, undefined)).toBe(true);
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
      '판정을 골라 주세요.',
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

  /**
   * 서버가 `trim()` 후 빈 문자열을 `null`로 접어 422로 거절한다. 화면이 공백을
   * 통과시키면 교직원은 「적었는데 안 된다」를 보게 된다.
   */
  it('공백만 적은 사유는 안 적은 것으로 본다', () => {
    expect(milestoneDocumentReviewFormError('REJECTED', '   \n\t  ')).toBe(
      '보완 요청과 반려는 사유를 입력해 주세요.',
    );
  });

  it('승인은 사유 없이도 저장할 수 있다', () => {
    expect(milestoneDocumentReviewFormError('APPROVED', '')).toBeNull();
  });

  it('사유를 적은 보완 요청은 저장할 수 있다', () => {
    expect(
      milestoneDocumentReviewFormError(
        'CHANGES_REQUESTED',
        '표지를 고쳐 주세요.',
      ),
    ).toBeNull();
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

  // `''`이 아니라 `undefined`여야 본문에서 키가 빠진다.
  it('공백만 남으면 아예 싣지 않는다', () => {
    expect(milestoneDocumentReviewCommentPayload('   ')).toBeUndefined();
    expect(milestoneDocumentReviewCommentPayload('')).toBeUndefined();
  });
});

describe('nextMilestoneDocumentReviewState', () => {
  const target = { applicationId: 'a1', documentId: 'd1' };

  it('닫혀 있으면 그 칸을 연다', () => {
    expect(nextMilestoneDocumentReviewState(null, target)).toEqual({
      target,
      decision: null,
      comment: '',
      isSubmitting: false,
      errorMessage: null,
    });
  });

  it('같은 칸을 다시 누르면 닫는다', () => {
    const open = createMilestoneDocumentReviewFormState(target);
    expect(nextMilestoneDocumentReviewState(open, target)).toBeNull();
  });

  /**
   * 앞 팀에 적던 사유가 다음 팀 칸에 남으면 그대로 저장돼 **엉뚱한 팀에 남의 지적이
   * 붙는다** — 그 사유는 학생에게 그대로 보인다.
   */
  it('다른 칸으로 옮기면 적어 둔 사유와 판정을 가져가지 않는다', () => {
    const open = {
      ...createMilestoneDocumentReviewFormState(target),
      decision: 'REJECTED' as const,
      comment: '가팀에 적던 지적',
    };
    const next = nextMilestoneDocumentReviewState(open, {
      applicationId: 'a2',
      documentId: 'd1',
    });

    expect(next).not.toBeNull();
    expect(next?.target).toEqual({ applicationId: 'a2', documentId: 'd1' });
    expect(next?.comment).toBe('');
    expect(next?.decision).toBeNull();
  });
});

describe('isSameMilestoneDocumentReviewTarget', () => {
  // 팀만 같고 서류가 다른 칸을 같다고 보면 패널이 남의 열에 열린다.
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
