import { describe, expect, it } from 'vitest';
import type {
  MilestoneDocumentSubmissionStatus,
  MilestoneDocumentViewerSubmission,
} from './milestone-document-api';
import {
  createMilestoneDocumentReviewFormState,
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
  it('미제출은 판정을 보기 전에 미제출이다', () => {
    expect(
      milestoneDocumentCellDisplay({ isSubmitted: false, review: null }),
    ).toBe('NOT_SUBMITTED');
  });

  /**
   * 계약상 미제출 칸에는 판정이 실리지 않지만, 어긋난 응답 한 건이 「안 낸 팀이 승인됨」
   * 으로 보이면 교직원은 그 팀을 독촉 대상에서 뺀다. 순서를 뒤집지 마라.
   */
  it('미제출 칸에 판정이 실려 와도 미제출로 읽는다', () => {
    expect(
      milestoneDocumentCellDisplay({
        isSubmitted: false,
        review: {
          decision: 'APPROVED',
          comment: null,
          reviewedAt: '2026-08-01T00:00:00.000Z',
        },
      }),
    ).toBe('NOT_SUBMITTED');
  });

  it('냈지만 아무도 보지 않았으면 검토 대기다', () => {
    expect(
      milestoneDocumentCellDisplay({ isSubmitted: true, review: null }),
    ).toBe('PENDING');
  });

  it('판정이 있으면 그 판정을 그대로 말한다', () => {
    for (const decision of MILESTONE_DOCUMENT_REVIEW_DECISION_ORDER) {
      expect(
        milestoneDocumentCellDisplay({
          isSubmitted: true,
          review: {
            decision,
            comment: null,
            reviewedAt: '2026-08-01T00:00:00.000Z',
          },
        }),
      ).toBe(decision);
    }
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
