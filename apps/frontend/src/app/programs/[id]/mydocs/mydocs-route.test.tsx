// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

type SubmissionChecklistPageProps = {
  readonly programId: string;
  readonly milestoneId: string | null;
  readonly onCloseSelected?: () => void;
  readonly onSelectMilestone?: (milestoneId: string) => void;
};

const navigation = vi.hoisted(() => ({
  router: {
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

vi.mock('@/features/submissions/submission-checklist-page', () => ({
  SubmissionChecklistPage: (props: SubmissionChecklistPageProps) => {
    captured.checklistProps = props;
    return null;
  },
}));

import { MyDocsRoute } from './mydocs-route';

function setSearchParams(query: string): void {
  navigation.searchParams = new URLSearchParams(query);
}

async function renderRoute(root: Root): Promise<void> {
  await act(async () => {
    root.render(<MyDocsRoute programId="program:basic" />);
  });
}

function checklistProps(): SubmissionChecklistPageProps {
  if (captured.checklistProps === null) {
    throw new Error('expected SubmissionChecklistPage props');
  }
  return captured.checklistProps;
}

describe('MyDocsRoute milestone query', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    captured.checklistProps = null;
    setSearchParams('');
    navigation.router.push.mockReset();
    navigation.router.replace.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('?milestoneId=를 SubmissionChecklistPage의 milestoneId로 전달한다', async () => {
    setSearchParams('milestoneId=milestone-1');
    await renderRoute(root);

    expect(checklistProps().programId).toBe('program:basic');
    expect(checklistProps().milestoneId).toBe('milestone-1');
  });

  it('마일스톤 선택 시 mydocs 경로로 push한다', async () => {
    await renderRoute(root);

    checklistProps().onSelectMilestone?.('final/report');

    expect(navigation.router.push).toHaveBeenCalledWith(
      '/programs/program%3Abasic/mydocs?milestoneId=final%2Freport',
      { scroll: false },
    );
  });

  it('닫기 시 milestoneId 쿼리를 제거한 mydocs 경로로 replace한다', async () => {
    setSearchParams('milestoneId=milestone-1&tab=overview');
    await renderRoute(root);

    checklistProps().onCloseSelected?.();

    expect(navigation.router.replace).toHaveBeenCalledWith(
      '/programs/program%3Abasic/mydocs?tab=overview',
      { scroll: false },
    );
  });
});
