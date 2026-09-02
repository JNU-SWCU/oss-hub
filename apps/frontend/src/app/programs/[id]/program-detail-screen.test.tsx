// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

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

async function renderScreen(root: Root): Promise<void> {
  await act(async () => {
    root.render(<ProgramDetailScreen programId="program:basic" />);
  });
}

function checklistProps(): SubmissionChecklistPageProps {
  if (captured.checklistProps === null) {
    throw new Error('expected SubmissionChecklistPage props');
  }
  return captured.checklistProps;
}

describe('ProgramDetailScreen submission navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    captured.checklistProps = null;
    setSearchParams('');
    navigation.router.back.mockReset();
    navigation.router.push.mockReset();
    navigation.router.replace.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('redirects a legacy submission deep link to the canonical documents screen', async () => {
    setSearchParams('submission=milestone-1&tab=overview');
    await renderScreen(root);

    expect(navigation.router.replace).toHaveBeenCalledWith(
      '/programs/program%3Abasic/documents?milestoneId=milestone-1',
    );
    expect(checklistProps().milestoneId).toBeNull();
  });

  it('opens a checklist item on the canonical documents screen', async () => {
    await renderScreen(root);
    checklistProps().onSelectMilestone?.('milestone-1');

    expect(navigation.router.push).toHaveBeenCalledWith(
      '/programs/program%3Abasic/documents?milestoneId=milestone-1',
      { scroll: false },
    );
    expect(navigation.router.replace).not.toHaveBeenCalled();
  });
});
