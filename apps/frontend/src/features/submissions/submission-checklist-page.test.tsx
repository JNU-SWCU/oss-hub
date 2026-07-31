import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import {
  createResubmission,
  getSubmissionChecklist,
  uploadSubmissionFile,
} from './api';
import { SubmissionChecklistPage } from './submission-checklist-page';
import type { SubmissionChecklistViewProps } from './components/submission-checklist-view';
import type { SubmissionChecklist } from './types';

const pageView = vi.hoisted(() => ({
  props: null as SubmissionChecklistViewProps | null,
}));

type StateSetter<T> = (nextValue: T | ((previous: T) => T)) => void;

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

  function useRef<T>(initialValue: T): { current: T } {
    const index = cursor;
    cursor += 1;
    const previous = slots[index] as { current: T } | undefined;
    if (previous) return previous;
    const ref = { current: initialValue };
    slots[index] = ref;
    return ref;
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

  return { begin, reset, run, useCallback, useEffect, useRef, useState };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: hooks.useCallback,
    useEffect: hooks.useEffect,
    useRef: hooks.useRef,
    useState: hooks.useState,
  };
});

vi.mock('./api', () => ({
  createResubmission: vi.fn(),
  getSubmissionChecklist: vi.fn(),
  uploadSubmissionFile: vi.fn(),
}));

vi.mock('./components/submission-checklist-view', () => ({
  ChecklistLoadFailure: () => null,
  ChecklistSkeleton: () => null,
  SubmissionChecklistView: (props: SubmissionChecklistViewProps) => {
    pageView.props = props;
    return null;
  },
}));

const CHECKLIST: SubmissionChecklist = {
  applicationId: 'application-1',
  applicationMode: 'PERSONAL',
  items: [
    {
      milestoneId: 'milestone-file',
      name: 'File replacement',
      dueAt: '2026-09-01T14:59:59.000Z',
      submissionType: 'FILE',
      submission: {
        id: 'submission-1',
        status: 'CHANGES_REQUESTED',
        currentRevision: 3,
        lastReviewedAt: '2026-08-28T01:00:00.000Z',
        reviewComment: 'Replace the file',
        canResubmit: true,
      },
    },
  ],
};

const FILE = new File(['%PDF'], 'r.pdf', { type: 'application/pdf' });

const CREATED_RESUBMISSION = {
  submissionId: 'submission-1',
  revision: 4,
  status: 'SUBMITTED',
} as const;

function uploaded(fileId: string) {
  return {
    fileId,
    fileName: 'r.pdf',
    contentType: 'application/pdf',
    size: 4,
    expiresAt: '2026-09-02T00:00:00.000Z',
  };
}

function problem(code: string): ProblemDetail {
  return {
    type: 'about:blank',
    title: code,
    status: 503,
    detail: code,
    instance: '/synthetic/submissions/submission-1/resubmissions',
    code,
  };
}

function currentViewProps(): SubmissionChecklistViewProps {
  if (pageView.props === null) {
    throw new Error('expected checklist view props');
  }
  return pageView.props;
}

function renderPage(): void {
  hooks.begin();
  renderToStaticMarkup(
    SubmissionChecklistPage({
      programId: 'program-1',
      milestoneId: 'milestone-file',
    }),
  );
  hooks.run();
}

async function flushAsyncWork(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) {
    await Promise.resolve();
  }
}

async function renderReadyPage(): Promise<void> {
  renderPage();
  await flushAsyncWork();
  renderPage();
}

async function selectFileAndSubmit(file: File): Promise<void> {
  currentViewProps().onFileChange(file);
  renderPage();
  currentViewProps().onResubmit();
  await flushAsyncWork();
  renderPage();
}

beforeEach(() => {
  hooks.reset();
  pageView.props = null;
  vi.mocked(getSubmissionChecklist).mockReset();
  vi.mocked(uploadSubmissionFile).mockReset();
  vi.mocked(createResubmission).mockReset();
  vi.mocked(getSubmissionChecklist).mockResolvedValue(CHECKLIST);
});

describe('SubmissionChecklistPage FILE resubmission retry cache', () => {
  it('discards the cached upload id when create-resubmission returns SUB_010', async () => {
    // Given
    vi.mocked(uploadSubmissionFile)
      .mockResolvedValueOnce(uploaded('file-first'))
      .mockResolvedValueOnce(uploaded('file-second'));
    vi.mocked(createResubmission)
      .mockRejectedValueOnce(new ApiError(problem('SUB_010')))
      .mockResolvedValueOnce(CREATED_RESUBMISSION);

    // When
    await renderReadyPage();
    await selectFileAndSubmit(FILE);
    await selectFileAndSubmit(FILE);

    // Then
    expect(uploadSubmissionFile).toHaveBeenCalledTimes(2);
    expect(uploadSubmissionFile).toHaveBeenNthCalledWith(
      2,
      'application-1',
      'milestone-file',
      FILE,
      { submissionId: 'submission-1', baseRevision: 3 },
    );
    expect(createResubmission).toHaveBeenNthCalledWith(2, {
      submissionId: 'submission-1',
      baseRevision: 3,
      content: { type: 'FILE', fileId: 'file-second' },
      comment: '',
    });
  });

  it('keeps the cached upload id for other retryable create-resubmission server errors', async () => {
    // Given
    vi.mocked(uploadSubmissionFile).mockResolvedValue(uploaded('file-first'));
    vi.mocked(createResubmission)
      .mockRejectedValueOnce(new ApiError(problem('SUB_999')))
      .mockResolvedValueOnce(CREATED_RESUBMISSION);

    // When
    await renderReadyPage();
    await selectFileAndSubmit(FILE);
    await selectFileAndSubmit(FILE);

    // Then
    expect(uploadSubmissionFile).toHaveBeenCalledTimes(1);
    expect(createResubmission).toHaveBeenNthCalledWith(2, {
      submissionId: 'submission-1',
      baseRevision: 3,
      content: { type: 'FILE', fileId: 'file-first' },
      comment: '',
    });
  });
});
