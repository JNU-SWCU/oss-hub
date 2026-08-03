import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ProgramDetailPageProps = {
  readonly programId: string;
  readonly approvedStudentMilestones?: ReactNode;
};

type SubmissionChecklistPageProps = {
  readonly programId: string;
  readonly milestoneId: string | null;
  readonly onCloseSelected?: () => void;
  readonly onSelectMilestone?: (milestoneId: string) => void;
};

const navigation = vi.hoisted(() => ({
  router: {
    back: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  },
  searchParams: new URLSearchParams(),
}));

const captured = vi.hoisted(() => ({
  checklistProps: null as SubmissionChecklistPageProps | null,
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
      previous === undefined ||
      next === undefined ||
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

  function runEffects(): void {
    const pendingEffects = effects;
    effects = [];
    for (const effect of pendingEffects) effect();
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

  return { begin, reset, runEffects, useEffect, useRef };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: hooks.useEffect,
    useRef: hooks.useRef,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.searchParams,
}));

vi.mock('@/features/programs/program-detail-page', () => ({
  ProgramDetailPage: ({ approvedStudentMilestones }: ProgramDetailPageProps) =>
    approvedStudentMilestones,
}));

vi.mock('@/features/submissions/submission-checklist-page', () => ({
  SubmissionChecklistPage: (props: SubmissionChecklistPageProps) => {
    captured.checklistProps = props;
    return null;
  },
}));

import { ProgramDetailScreen } from './program-detail-screen';

function setSearchParams(query: string): void {
  navigation.searchParams = new URLSearchParams(query);
}

function renderScreen(): void {
  hooks.begin();
  renderToStaticMarkup(<ProgramDetailScreen programId="program:basic" />);
  hooks.runEffects();
}

function checklistProps(): SubmissionChecklistPageProps {
  if (captured.checklistProps === null) {
    throw new Error('expected SubmissionChecklistPage props');
  }
  return captured.checklistProps;
}

describe('ProgramDetailScreen submission dialog history', () => {
  beforeEach(() => {
    hooks.reset();
    captured.checklistProps = null;
    setSearchParams('');
    navigation.router.back.mockReset();
    navigation.router.push.mockReset();
    navigation.router.replace.mockReset();
  });

  it('closes a direct deep-linked submission by replacing the query', () => {
    setSearchParams('submission=milestone-1&tab=overview');
    renderScreen();

    checklistProps().onCloseSelected?.();

    expect(navigation.router.replace).toHaveBeenCalledWith(
      '/programs/program%3Abasic?tab=overview',
      { scroll: false },
    );
    expect(navigation.router.back).not.toHaveBeenCalled();
  });

  it('closes an in-page opened submission with browser back', () => {
    renderScreen();
    checklistProps().onSelectMilestone?.('milestone-1');
    setSearchParams('submission=milestone-1');
    renderScreen();

    checklistProps().onCloseSelected?.();

    expect(navigation.router.push).toHaveBeenCalledWith(
      '/programs/program%3Abasic?submission=milestone-1',
      { scroll: false },
    );
    expect(navigation.router.back).toHaveBeenCalledTimes(1);
    expect(navigation.router.replace).not.toHaveBeenCalled();
  });

  it('preserves in-page provenance after browser back and forward restore the submission query', () => {
    renderScreen();
    checklistProps().onSelectMilestone?.('milestone-1');
    setSearchParams('submission=milestone-1');
    renderScreen();
    setSearchParams('');
    renderScreen();
    expect(checklistProps().milestoneId).toBeNull();
    setSearchParams('submission=milestone-1');
    renderScreen();
    expect(checklistProps().milestoneId).toBe('milestone-1');

    checklistProps().onCloseSelected?.();

    expect(navigation.router.back).toHaveBeenCalledTimes(1);
    expect(navigation.router.replace).not.toHaveBeenCalled();
  });
});
