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
  it('다시 낸 칸은 지난 보완 요청이 남아 있어도 재검토 대기다', () => {
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

    expect(milestoneDocumentCellDisplay(resubmitted)).toBe('REPENDING');
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

  it('두 번째 이상 제출본은 재검토 대기로 분명히 말한다', () => {
    expect(
      milestoneDocumentViewerDisplay(
        viewer({ status: 'SUBMITTED', revision: 2 }),
      ),
    ).toBe('REPENDING');
    expect(MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS.REPENDING).toBe(
      '재검토 대기',
    );
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
  it('첫 검토 대기와 재검토 대기를 다른 말로 구분한다', () => {
    expect(MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS).toEqual({
      NOT_SUBMITTED: '미제출',
      PENDING: '검토 대기',
      REPENDING: '재검토 대기',
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

  /**
   * #1097 — 보완 요청에 응해 **한 번 다시 낸** 서류(재검토 대기). 위 「나머지 상태」의
   * `SUBMITTED`와 값은 같지만 사연이 다르므로 따로 못 박는다: 재제출이 상태를 되돌려
   * 놓았을 뿐 판정 이력에는 보완 요청이 남아 있다.
   *
   * 여기서 잠그는 것이 규칙이다 — 재제출은 한 번이고, 교직원이 검토하는 동안 내용은 바뀌지
   * 않는다. 서버도 이 조합을 422(MSD_031)로 막으므로 화면과 서버가 같은 답을 낸다.
   * 예전에는 서버만 열려 있어 「버튼은 잠겼는데 요청은 통과하는」 어긋남이었다.
   */
  it('마감 뒤, 보완 요청에 이미 응한 재검토 대기는 잠근 채로 둔다', () => {
    expect(
      isMilestoneDocumentDeadlineLocked(
        true,
        viewer({
          status: 'SUBMITTED',
          revision: 2,
          review: {
            comment: '3쪽 서명이 빠졌습니다.',
            reviewedAt: '2026-08-02T00:00:00.000Z',
          },
        }),
      ),
    ).toBe(true);
  });

  /**
   * 잠그는 것은 **마감**이다. 같은 재검토 대기라도 마감 전이면 열려 있어야 한다 — 마감 전
   * 파일 교체는 지금도 되는 일이고, 서버도 마감 전에는 이 조합을 받는다.
   */
  it('마감 전이면 재검토 대기도 잠기지 않는다', () => {
    expect(
      isMilestoneDocumentDeadlineLocked(
        false,
        viewer({ status: 'SUBMITTED', revision: 2 }),
      ),
    ).toBe(false);
  });

  /**
   * 화면이 실제로 조작을 여는 자리 = `isMilestoneDocumentResubmittable` ∧
   * `!isMilestoneDocumentDeadlineLocked`. 이 표는 서버의
   * `milestoneDocumentSubmissionBlock` 스펙에 **같은 순서로** 한 벌 더 있다
   * (`apps/backend/src/milestone-documents/domain/milestone-document-submission-window.spec.ts`).
   * 두 표가 갈라지면 #1097이 그대로 돌아오므로, 한쪽을 고칠 때 다른 쪽도 함께 고친다.
   */
  it.each([
    // [마감 지남, 제출 상태, 리비전, 화면이 조작을 여는가]
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

/**
 * 변이 검증 대상 — 승인 사유를 학생에게 보여 주는 규칙이 여기 있다.
 *
 * 판정 폼은 사유 칸에 「학생에게 그대로 보입니다」라고 적어 두고 승인에도 사유를 받는다.
 * 승인만 상자를 안 그리면 교직원이 적은 말이 어디에도 나오지 않아, **화면이 약속한 것을
 * 안 지키는 상태**가 된다.
 */
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
    /*
     * 사유가 필수인데도 비어 온 경우다(계약상 없지만 응답 하나가 어긋나면 난다).
     * 여기서 상자를 지우면 학생은 **서류가 되돌아온 사실 자체**를 모른다.
     */
    expect(milestoneDocumentReviewNoticeTone('CHANGES_REQUESTED', null)).toBe(
      'warning',
    );
    expect(milestoneDocumentReviewNoticeTone('REJECTED', null)).toBe('warning');
  });

  // 같은 빨간 상자에 담으면 승인인데 문제가 있는 것처럼 읽힌다.
  it('사유를 적은 승인은 중립 톤으로 보여 준다', () => {
    expect(
      milestoneDocumentReviewNoticeTone(
        'APPROVED',
        '잘 받았습니다. 다음 단계를 안내드릴게요.',
      ),
    ).toBe('neutral');
  });

  // 승인은 사유가 선택이다 — 비어 있으면 배지가 이미 말한 「승인」 아래 빈 상자만 남는다.
  it('사유 없는 승인에는 상자를 세우지 않는다', () => {
    expect(milestoneDocumentReviewNoticeTone('APPROVED', null)).toBeNull();
    expect(milestoneDocumentReviewNoticeTone('APPROVED', '   ')).toBeNull();
  });

  // 아직 판정이 없거나 다시 낸 뒤로 돌아온 자리에는 지난 지적을 다시 펴지 않는다.
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

/**
 * 판정을 「내가 본 그 제출물」에 묶는 값. 이것이 틀리면 서버의 대조가 뜻을 잃고,
 * 표를 그린 뒤 바뀐 제출물에 판정이 조용히 얹힌다.
 */
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

  /**
   * 아직 아무도 판정하지 않은 칸은 **`null`을 명시해서** 보낸다. `undefined`가 되면
   * `JSON.stringify`가 키를 통째로 지워 서버가 400으로 막는다 — 승인 한 번이 통째로
   * 실패하는데 화면은 「요청 값을 확인해 주세요」만 말한다.
   */
  it('판정이 없던 칸은 undefined가 아니라 null을 싣는다', () => {
    const version = milestoneDocumentReviewVersionOf({
      revision: 1,
      review: null,
    });

    expect(version?.expectedLatestReviewId).toBeNull();
    // 키가 살아 있어야 한다 — `undefined`면 본문에서 사라진다.
    expect(JSON.parse(JSON.stringify(version))).toEqual({
      expectedRevision: 1,
      expectedLatestReviewId: null,
    });
  });

  /**
   * 지어낸 값은 대조를 통과하고, 그 통과는 거짓이다. 특히 `?? 1` 같은 기본값을 두면
   * 「번호를 못 읽었다」가 「1번 제출본을 봤다」로 바뀌어 나간다 — 그 칸이 실제로 1번
   * 제출본이면 서버는 순순히 통과시킨다.
   */
  it('제출본 번호가 없는 칸에서는 아무 값도 지어내지 않는다', () => {
    expect(
      milestoneDocumentReviewVersionOf({ revision: null, review: null }),
    ).toBeNull();
  });

  /**
   * 첫 제출이 1이라 0·음수는 **어떤 제출도 가리키지 않는다**. 서버도 그렇게 보고 400으로
   * 막는데(`@Min(1)`), 그 400은 교직원이 고칠 수 있는 것이 아니다 — 여기서 버려야
   * 「표를 다시 불러 주세요」라고 말할 수 있다.
   */
  it('1보다 작은 번호는 실어 보내지 않는다', () => {
    expect(
      milestoneDocumentReviewVersionOf({ revision: 0, review: null }),
    ).toBeNull();
    expect(
      milestoneDocumentReviewVersionOf({ revision: -1, review: null }),
    ).toBeNull();
  });

  // 정상 범위는 그대로 지나간다 — 위 방어가 1번 제출까지 삼키면 첫 판정이 통째로 막힌다.
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

  /**
   * 앞 팀에 적던 사유가 다음 팀 칸에 남으면 그대로 저장돼 **엉뚱한 팀에 남의 지적이
   * 붙는다** — 그 사유는 학생에게 그대로 보인다.
   */
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
    // 버전도 옮겨 간 칸의 것이어야 한다 — 앞 칸의 것을 물고 가면 남의 제출물에 대고
    // 대조하게 되어 언제나 409다.
    expect(next?.version).toEqual({
      expectedRevision: 3,
      expectedLatestReviewId: 'review-2',
    });
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
