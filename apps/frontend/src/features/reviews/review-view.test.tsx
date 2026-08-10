import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SubmissionReviewView } from './components/submission-review-view';
import type { ReviewContext } from './types';

const noOp = () => undefined;

function context(overrides?: Partial<ReviewContext>): ReviewContext {
  return {
    submissionId: 'submission-existing',
    application: {
      id: 'application-personal',
      applicationMode: 'PERSONAL',
      displayName: '합성 신청자',
    },
    milestone: { id: 'milestone-final', name: '최종 제출' },
    currentRevision: {
      number: 2,
      content: { type: 'TEXT', text: 'https://example.com/repository' },
      comment: '수정했습니다.',
      submittedAt: '2026-09-27T01:00:00.000Z',
      files: [],
      review: null,
    },
    history: [],
    repository: {
      id: 'repository-ready',
      url: 'https://example.com/repository',
      visibility: 'PRIVATE',
      publishEligible: false,
      blockedReasons: ['REQUIRED_MILESTONES_NOT_APPROVED'],
    },
    ...overrides,
  };
}

function render(reviewContext: ReviewContext): string {
  return renderToStaticMarkup(
    <SubmissionReviewView
      context={reviewContext}
      decision=""
      comment=""
      isSaving={false}
      isPublishing={false}
      formError={null}
      notice={null}
      publishError={null}
      onDecisionChange={noOp}
      onCommentChange={noOp}
      onSave={noOp}
      onCancel={noOp}
      onPublish={noOp}
    />,
  );
}

describe('SubmissionReviewView', () => {
  it('판정 선택 오류를 라디오 그룹에 연결한다', () => {
    const html = renderToStaticMarkup(
      <SubmissionReviewView
        context={context()}
        decision=""
        comment=""
        isSaving={false}
        isPublishing={false}
        formError="판정을 선택해 주세요."
        notice={null}
        publishError={null}
        onDecisionChange={noOp}
        onCommentChange={noOp}
        onSave={noOp}
        onCancel={noOp}
        onPublish={noOp}
      />,
    );

    expect(html).toContain('aria-describedby="review-decision-error"');
    expect(html).toContain('id="review-decision-error"');
    expect(html).not.toContain('id="review-comment-error"');
  });

  it('미검토 revision에 세 가지 판정과 코멘트 입력을 표시한다', () => {
    // Given
    const reviewContext = context();

    // When
    const html = render(reviewContext);

    // Then
    expect(html).toContain('name="review-decision"');
    expect(html).toContain('value="APPROVED"');
    expect(html).toContain('value="CHANGES_REQUESTED"');
    expect(html).toContain('value="REJECTED"');
    expect(html).toContain('판정 저장');
    expect(html).toContain('제출 링크');
    expect(html).toContain('href="https://example.com/repository"');
    // QA48 — 제출 본문이 그대로 문서로 보여야 하고, raw JSON은 새 나가면 안 된다.
    expect(html).toContain('제출 내용');
    expect(html).not.toContain('"type"');
  });

  // #354 — 검토 화면은 교직원과 학생이 함께 보는 흐름이라 내부 데이터 용어
  // revision을 그대로 노출하지 않는다. 이력이 없을 때는 그 뜻까지 풀어 준다.
  it('제출본 번호·이력·판정 설명에 내부 용어 revision을 노출하지 않는다', () => {
    // Given: 1회차 + history 비어 있음 = 진짜 최초 제출 분기를 함께 지난다.
    const reviewContext = context({
      currentRevision: { ...context().currentRevision, number: 1 },
      history: [],
    });

    // When
    const html = render(reviewContext);

    // Then
    expect(html).toContain('제출본 1번');
    expect(html).toContain('이전 제출본과 판정 이력');
    expect(html).toContain('이전 제출본이 없습니다');
    expect(html).toContain('최초 제출입니다');
    expect(html).toContain('현재 제출본을 승인합니다');
    // aria 속성·id를 뺀 사용자 가시 문구에는 revision이 남지 않아야 한다.
    expect(html.replace(/revision-history-title/g, '')).not.toMatch(
      /revision/i,
    );
  });

  // #354 — 이력이 비어 있는 것과 실제로 첫 제출인 것은 다르다. 이력 조회가
  // 실패하거나 잘려도 화면은 "최초 제출"로 읽혔고, 교직원이 재제출본을 최초
  // 제출로 오인하면 판정이 틀어진다. 회차 값 자체가 판정 근거여야 한다.
  it('회차가 2 이상인데 이력이 비어 있으면 최초 제출이라고 하지 않는다', () => {
    // Given: 2회차 제출본인데 이전 이력이 비어 있는 조합.
    const reviewContext = context({
      currentRevision: { ...context().currentRevision, number: 2 },
      history: [],
    });

    // When
    const html = render(reviewContext);

    // Then
    expect(html).not.toContain('최초 제출입니다');
    expect(html).not.toContain('이전 제출본이 없습니다');
    expect(html).toContain('2번째');
    expect(html).toContain('이력을 불러오지 못했습니다');
  });

  it('회차가 1이고 이력이 비어 있을 때만 최초 제출이라고 안내한다', () => {
    // Given
    const reviewContext = context({
      currentRevision: { ...context().currentRevision, number: 1 },
      history: [],
    });

    // When
    const html = render(reviewContext);

    // Then
    expect(html).toContain('이전 제출본이 없습니다');
    expect(html).toContain('최초 제출입니다');
    expect(html).not.toContain('이력을 불러오지 못했습니다');
  });

  it('이미 검토한 최신 revision은 판정과 코멘트를 읽기 전용으로 표시한다', () => {
    // Given
    const reviewContext = context({
      repository: null,
      currentRevision: {
        number: 2,
        content: { type: 'TEXT', text: '승인 대상 본문' },
        comment: null,
        submittedAt: '2026-09-27T01:00:00.000Z',
        files: [],
        review: {
          id: 'review-approved',
          decision: 'APPROVED',
          comment: '확인했습니다.',
          reviewedAt: '2026-09-28T01:00:00.000Z',
        },
      },
    });

    // When
    const html = render(reviewContext);

    // Then
    expect(html).toContain('승인');
    expect(html).toContain('확인했습니다.');
    expect(html).not.toContain('name="review-decision"');
    expect(html).not.toContain('type="submit"');
  });

  it('보완 요청은 재제출 가능한 대기 상태 색으로 표시한다', () => {
    // Given
    const reviewContext = context({
      repository: null,
      currentRevision: {
        number: 2,
        content: { type: 'TEXT', text: '보완 요청 대상 본문' },
        comment: null,
        submittedAt: '2026-09-27T01:00:00.000Z',
        files: [],
        review: {
          id: 'review-changes-requested',
          decision: 'CHANGES_REQUESTED',
          comment: '실행 화면을 추가해 주세요.',
          reviewedAt: '2026-09-28T01:00:00.000Z',
        },
      },
    });

    // When
    const html = render(reviewContext);

    // Then
    expect(html).toContain('data-variant="pending"');
    expect(html).toContain('보완 요청');
  });

  it('공개 조건이 충족되지 않으면 사유를 알리고 공개 버튼을 비활성화한다', () => {
    // Given
    const reviewContext = context();

    // When
    const html = render(reviewContext);

    // Then
    expect(html).toContain('모든 필수 마일스톤의 승인이 필요합니다.');
    expect(html).toContain('disabled=""');
  });

  it('이미 공개된 저장소는 PUBLIC 상태와 저장소 링크를 표시한다', () => {
    // Given
    const reviewContext = context({
      repository: {
        id: 'repository-public',
        url: 'https://example.com/repository-public',
        visibility: 'PUBLIC',
        publishEligible: true,
        blockedReasons: [],
      },
    });

    // When
    const html = render(reviewContext);

    // Then
    expect(html).toContain('PUBLIC');
    expect(html).toContain('href="https://example.com/repository-public"');
    expect(html).not.toContain('GitHub 저장소 공개 전환');
  });
});
