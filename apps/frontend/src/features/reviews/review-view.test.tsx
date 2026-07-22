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
      content: { repositoryUrl: 'https://example.com/repository' },
      comment: '수정했습니다.',
      submittedAt: '2026-09-27T01:00:00.000Z',
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
  });

  it('이미 검토한 최신 revision은 판정과 코멘트를 읽기 전용으로 표시한다', () => {
    // Given
    const reviewContext = context({
      repository: null,
      currentRevision: {
        number: 2,
        content: {},
        comment: null,
        submittedAt: '2026-09-27T01:00:00.000Z',
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
        content: {},
        comment: null,
        submittedAt: '2026-09-27T01:00:00.000Z',
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
