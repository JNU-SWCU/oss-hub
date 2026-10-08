import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReview, getReviewContext, publishRepository } from './api';
import { SubmissionReviewScreen } from './components/submission-review-screen';
import type { SubmissionReviewViewProps } from './components/submission-review-view';
import type { ReviewContext } from './types';

const reviewView = vi.hoisted(() => ({
  props: null as SubmissionReviewViewProps | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn() }),
}));

vi.mock('./api', () => ({
  createReview: vi.fn(),
  getReviewContext: vi.fn(),
  publishRepository: vi.fn(),
}));

vi.mock('./components/submission-review-view', () => ({
  SubmissionReviewView: (props: SubmissionReviewViewProps) => {
    reviewView.props = props;
    return null;
  },
}));

const CONTEXT: ReviewContext = {
  submissionId: 'submission-existing',
  application: {
    id: 'application-personal',
    applicationMode: 'PERSONAL',
    displayName: '합성 신청자',
  },
  milestone: { id: 'milestone-final', name: '최종 제출' },
  currentRevision: {
    number: 2,
    content: { type: 'TEXT', text: '수정 사항을 반영한 제출본입니다.' },
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
    publishEligible: true,
    blockedReasons: [],
  },
};

function currentProps(): SubmissionReviewViewProps {
  if (reviewView.props === null) throw new Error('expected review view props');
  return reviewView.props;
}

let root: Root;
let container: HTMLDivElement;
async function renderReadyScreen(): Promise<void> {
  await act(() => {
    root.render(<SubmissionReviewScreen submissionId="submission-existing" />);
    return Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  reviewView.props = null;
  vi.mocked(getReviewContext).mockReset().mockResolvedValue(CONTEXT);
  vi.mocked(createReview).mockReset();
  vi.mocked(publishRepository).mockReset();
});
afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
  vi.unstubAllGlobals();
});

describe('SubmissionReviewScreen 실패 안내 (#354)', () => {
  it('판정 저장 실패 안내는 입력이 남아 있다는 사실을 알려주고 실제로도 남긴다', async () => {
    vi.mocked(createReview).mockRejectedValue(new Error('network down'));
    await renderReadyScreen();
    await act(() =>
      Promise.resolve(currentProps().onDecisionChange('CHANGES_REQUESTED')),
    );
    await act(() =>
      Promise.resolve(
        currentProps().onCommentChange('실행 화면 캡처를 추가해 주세요.'),
      ),
    );

    await act(() => Promise.resolve(currentProps().onSave()));

    const props = currentProps();
    expect(props.formError).toBe(
      '저장하지 못했습니다. 선택한 결과와 코멘트는 그대로 남아 있으니 다시 저장해 주세요.',
    );
    expect(props.decision).toBe('CHANGES_REQUESTED');
    expect(props.comment).toBe('실행 화면 캡처를 추가해 주세요.');

    expect(props.formError).not.toBe('저장하지 못했습니다.');
  });

  it('저장소 공개 전환 실패 안내는 확인할 대상과 다음 행동을 알려준다', async () => {
    vi.mocked(publishRepository).mockRejectedValue(new Error('network down'));
    await renderReadyScreen();

    await act(() => Promise.resolve(currentProps().onPublish()));

    const message = currentProps().publishError ?? '';
    expect(message).toContain('현재 공개 상태를 확인한 뒤 다시 시도해 주세요');
    expect(message).not.toBe('저장소를 공개 전환하지 못했습니다.');
  });
});

it('a callback for an older revision cannot open a newer submission', async () => {
  await renderReadyScreen();
  vi.mocked(getReviewContext).mockResolvedValue({
    ...CONTEXT,
    currentRevision: { ...CONTEXT.currentRevision, number: 3 },
  });
  await act(() => Promise.resolve(window.dispatchEvent(new Event('focus'))));
  const openThird = currentProps().onOpenLatestRevision;
  expect(currentProps().needsLatestRevision).toBe(true);
  vi.mocked(getReviewContext).mockResolvedValue({
    ...CONTEXT,
    currentRevision: { ...CONTEXT.currentRevision, number: 4 },
  });
  await act(() => Promise.resolve(window.dispatchEvent(new Event('focus'))));
  await act(() => Promise.resolve(openThird?.()));
  expect(currentProps().needsLatestRevision).toBe(true);
  expect(currentProps().decision).toBe('');
});
