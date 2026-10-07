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
        formError="승인, 보완 요청, 반려 중 하나를 골라 주세요."
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
    const reviewContext = context();

    const html = render(reviewContext);

    expect(html).toContain('name="review-decision"');
    expect(html).toContain('value="APPROVED"');
    expect(html).toContain('value="CHANGES_REQUESTED"');
    expect(html).toContain('value="REJECTED"');
    expect(html).toContain('>저장<');
    expect(html).toContain('제출 링크');
    expect(html).toContain('href="https://example.com/repository"');

    expect(html).toContain('제출 내용');
    expect(html).not.toContain('"type"');
  });

  it('제출본 번호·이력·판정 설명에 내부 용어 revision을 노출하지 않는다', () => {
    const reviewContext = context({
      currentRevision: { ...context().currentRevision, number: 1 },
      history: [],
    });

    const html = render(reviewContext);

    expect(html).toContain('제출본 1번');
    expect(html).toContain('이전 제출본과 검토 이력');
    expect(html).toContain('첫 제출입니다.');
    expect(html).toContain('현재 제출본을 승인합니다');

    expect(html.replace(/revision-history-title/g, '')).not.toMatch(
      /revision/i,
    );
  });

  it('회차가 2 이상인데 이력이 비어 있으면 최초 제출이라고 하지 않는다', () => {
    const reviewContext = context({
      currentRevision: { ...context().currentRevision, number: 2 },
      history: [],
    });

    const html = render(reviewContext);

    expect(html).not.toContain('첫 제출입니다.');
    expect(html).toContain('2번째');
    expect(html).toContain('이전 이력을 확인할 수 없습니다');
  });

  it('회차가 1이고 이력이 비어 있을 때만 최초 제출이라고 안내한다', () => {
    const reviewContext = context({
      currentRevision: { ...context().currentRevision, number: 1 },
      history: [],
    });

    const html = render(reviewContext);

    expect(html).toContain('첫 제출입니다.');
    expect(html).not.toContain('이전 이력을 확인할 수 없습니다');
  });

  it('이미 검토한 최신 revision은 판정과 코멘트를 읽기 전용으로 표시한다', () => {
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

    const html = render(reviewContext);

    expect(html).toContain('승인');
    expect(html).toContain('확인했습니다.');
    expect(html).not.toContain('name="review-decision"');
    expect(html).not.toContain('type="submit"');
  });

  it('보완 요청은 재제출 가능한 대기 상태 색으로 표시한다', () => {
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

    const html = render(reviewContext);

    expect(html).toContain('data-variant="pending"');
    expect(html).toContain('보완 요청');
  });

  it('공개 조건이 충족되지 않으면 사유를 알리고 공개 버튼을 비활성화한다', () => {
    const reviewContext = context();

    const html = render(reviewContext);

    expect(html).toContain('모든 필수 마일스톤의 승인이 필요합니다.');
    expect(html).toContain('disabled=""');
  });

  it('전체 검토 화면이 적격 저장소의 공개 전환 버튼을 연다', () => {
    const reviewContext = context({
      repository: {
        id: 'repository-eligible',
        url: 'https://example.com/repository-eligible',
        visibility: 'PRIVATE',
        publishEligible: true,
        blockedReasons: [],
      },
    });

    const html = render(reviewContext);

    const publishButton = html.match(
      /<button\b[^>]*>GitHub 저장소 공개 전환<\/button>/,
    )?.[0];
    expect(publishButton).toBeDefined();
    expect(publishButton).not.toContain('disabled=""');
    expect(html).toContain('GitHub 저장소 공개 전환');
    expect(html).toContain('공개 조건을 모두 충족해 공개할 수 있습니다.');
    expect(html).not.toContain('모든 필수 마일스톤의 승인이 필요합니다.');
  });

  it('이미 공개된 저장소는 PUBLIC 상태와 저장소 링크를 표시한다', () => {
    const reviewContext = context({
      repository: {
        id: 'repository-public',
        url: 'https://example.com/repository-public',
        visibility: 'PUBLIC',
        publishEligible: true,
        blockedReasons: [],
      },
    });

    const html = render(reviewContext);

    expect(html).toContain('PUBLIC');
    expect(html).toContain('href="https://example.com/repository-public"');
    expect(html).not.toContain('GitHub 저장소 공개 전환');
  });
});
