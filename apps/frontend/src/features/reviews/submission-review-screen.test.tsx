import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReview, getReviewContext, publishRepository } from './api';
import { SubmissionReviewScreen } from './components/submission-review-screen';
import type { SubmissionReviewViewProps } from './components/submission-review-view';
import type { ReviewContext } from './types';

type StateSetter<T> = (nextValue: T | ((previous: T) => T)) => void;

const reviewView = vi.hoisted(() => ({
  props: null as SubmissionReviewViewProps | null,
}));

const hooks = vi.hoisted(() => {
  const slots: unknown[] = [];
  let cursor = 0;
  let effects: Array<() => void> = [];

  function depsChanged(
    previous: readonly unknown[] | undefined,
    next: readonly unknown[] | undefined,
  ): boolean {
    return (
      next === undefined ||
      previous === undefined ||
      previous.length !== next.length ||
      next.some((value, index) => !Object.is(value, previous[index]))
    );
  }

  function begin(): void {
    cursor = 0;
    effects = [];
  }

  function reset(): void {
    slots.length = 0;
    begin();
  }

  function run(): void {
    const pendingEffects = effects;
    effects = [];
    for (const effect of pendingEffects) effect();
  }

  function useCallback<T extends (...args: readonly never[]) => unknown>(
    value: T,
    deps: readonly unknown[] | undefined,
  ): T {
    const index = cursor;
    cursor += 1;
    const previous = slots[index] as
      | { readonly deps: readonly unknown[] | undefined; readonly value: T }
      | undefined;
    if (previous && !depsChanged(previous.deps, deps)) return previous.value;
    slots[index] = { deps, value };
    return value;
  }

  function useEffect(
    effect: () => void,
    deps: readonly unknown[] | undefined,
  ): void {
    const index = cursor;
    cursor += 1;
    const previous = slots[index] as readonly unknown[] | undefined;
    if (!depsChanged(previous, deps)) return;
    slots[index] = deps;
    effects.push(effect);
  }

  function useState<T>(initialValue: T): [T, StateSetter<T>] {
    const index = cursor;
    cursor += 1;
    if (slots[index] === undefined) slots[index] = initialValue;
    const setState: StateSetter<T> = (nextValue) => {
      const previous = slots[index] as T;
      slots[index] =
        typeof nextValue === 'function'
          ? (nextValue as (previous: T) => T)(previous)
          : nextValue;
    };
    return [slots[index] as T, setState];
  }

  return { begin, reset, run, useCallback, useEffect, useState };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: hooks.useCallback,
    useEffect: hooks.useEffect,
    useState: hooks.useState,
  };
});

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
    content: { repositoryUrl: 'https://example.com/repository' },
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

function renderScreen(): void {
  hooks.begin();
  renderToStaticMarkup(
    SubmissionReviewScreen({ submissionId: 'submission-existing' }),
  );
  hooks.run();
}

async function flushAsyncWork(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
}

async function renderReadyScreen(): Promise<void> {
  renderScreen();
  await flushAsyncWork();
  renderScreen();
}

beforeEach(() => {
  hooks.reset();
  reviewView.props = null;
  vi.mocked(getReviewContext).mockReset();
  vi.mocked(createReview).mockReset();
  vi.mocked(publishRepository).mockReset();
  vi.mocked(getReviewContext).mockResolvedValue(CONTEXT);
});

describe('SubmissionReviewScreen 실패 안내 (#354)', () => {
  it('판정 저장 실패 안내는 입력이 남아 있다는 사실을 알려주고 실제로도 남긴다', async () => {
    // Given — 판정과 코멘트를 채운 뒤 저장이 네트워크 오류로 실패한다.
    vi.mocked(createReview).mockRejectedValue(new Error('network down'));
    await renderReadyScreen();
    currentProps().onDecisionChange('CHANGES_REQUESTED');
    renderScreen();
    currentProps().onCommentChange('실행 화면 캡처를 추가해 주세요.');
    renderScreen();

    // When
    currentProps().onSave();
    await flushAsyncWork();
    renderScreen();

    // Then — 문구가 "유지했다"고 말하고, 화면 상태도 실제로 유지한다.
    const props = currentProps();
    expect(props.formError).toBe(
      '판정을 저장하지 못했습니다. 선택한 판정과 코멘트는 그대로 남아 있으니 다시 저장해 주세요.',
    );
    expect(props.decision).toBe('CHANGES_REQUESTED');
    expect(props.comment).toBe('실행 화면 캡처를 추가해 주세요.');
    // 옛 문구는 한 문장으로 끝나 입력이 남았는지 알 수 없었다.
    expect(props.formError).not.toBe('판정을 저장하지 못했습니다.');
  });

  it('저장소 공개 전환 실패 안내는 확인할 대상과 다음 행동을 알려준다', async () => {
    // Given
    vi.mocked(publishRepository).mockRejectedValue(new Error('network down'));
    await renderReadyScreen();

    // When
    currentProps().onPublish();
    await flushAsyncWork();
    renderScreen();

    // Then
    const message = currentProps().publishError ?? '';
    expect(message).toContain('현재 공개 상태를 확인한 뒤 다시 시도해 주세요');
    expect(message).not.toBe('저장소를 공개 전환하지 못했습니다.');
  });
});
