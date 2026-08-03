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

const openedInPage = vi.hoisted(() => ({ current: false }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useRef: () => openedInPage,
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
  renderToStaticMarkup(<ProgramDetailScreen programId="program:basic" />);
}

function checklistProps(): SubmissionChecklistPageProps {
  if (captured.checklistProps === null) {
    throw new Error('expected SubmissionChecklistPage props');
  }
  return captured.checklistProps;
}

describe('ProgramDetailScreen submission dialog history', () => {
  beforeEach(() => {
    openedInPage.current = false;
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
