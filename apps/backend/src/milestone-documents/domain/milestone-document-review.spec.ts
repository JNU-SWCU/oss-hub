import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import {
  isResubmissionAllowedAfter,
  reviewDecisionToSubmissionStatus,
} from './milestone-document-review';

// 합성 데이터만 사용한다 (docs/rules/security.md)

describe('reviewDecisionToSubmissionStatus', () => {
  it.each([
    [ReviewDecision.APPROVED, SubmissionStatus.APPROVED],
    [ReviewDecision.CHANGES_REQUESTED, SubmissionStatus.CHANGES_REQUESTED],
    [ReviewDecision.REJECTED, SubmissionStatus.REJECTED],
  ])('%s는 제출 상태 %s에 대응한다', (decision, status) => {
    // Given / When / Then: 옛 제출물 판정의 매핑 표와 같은 값이어야 한다.
    expect(reviewDecisionToSubmissionStatus(decision)).toBe(status);
  });

  it('모든 판정 값에 대응 상태가 있다 — 빠진 값이 있으면 undefined가 새어 나간다', () => {
    // Given
    const decisions = Object.values(ReviewDecision);

    // When
    const statuses = decisions.map(reviewDecisionToSubmissionStatus);

    // Then
    expect(statuses).toHaveLength(decisions.length);
    expect(statuses.every((status) => status !== undefined)).toBe(true);
  });
});

describe('isResubmissionAllowedAfter', () => {
  it('판정이 없으면 허용한다 — 첫 제출이거나 아직 아무도 보지 않았다', () => {
    // Given / When / Then
    expect(isResubmissionAllowedAfter(null)).toBe(true);
  });

  it('보완 요청 뒤에는 허용한다 — 「다시 내라」는 뜻이다', () => {
    // Given / When / Then
    expect(isResubmissionAllowedAfter(ReviewDecision.CHANGES_REQUESTED)).toBe(
      true,
    );
  });

  it('승인 뒤에는 막는다 — 승인된 서류가 조용히 다른 내용으로 바뀌면 안 된다', () => {
    // Given / When / Then
    expect(isResubmissionAllowedAfter(ReviewDecision.APPROVED)).toBe(false);
  });

  it('반려 뒤에는 막는다 — 끝난 판정이다', () => {
    // Given / When / Then
    expect(isResubmissionAllowedAfter(ReviewDecision.REJECTED)).toBe(false);
  });
});
