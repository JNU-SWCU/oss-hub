// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoleResult } from '../../../_shell/use-session-role';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

type MatrixProps = {
  readonly programId: string;
  readonly selectedMilestoneId: string | null;
  readonly onSelectMilestone: (milestoneId: string | null) => void;
};

type ChecklistProps = {
  readonly programId: string;
  readonly milestoneId: string | null;
  readonly onCloseSelected?: () => void;
  readonly onSelectMilestone?: (milestoneId: string) => void;
};

const STAFF: SessionRoleResult = {
  status: 'assigned',
  memberKind: 'STAFF',
  hasStaffAccess: true,
  hasAdminAccess: false,
  staffAccessRequestStatus: null,
  staffAccessRequestRejectionReason: null,
  selectedRole: null,
  isProfileComplete: true,
  retry: vi.fn(),
};

const STUDENT: SessionRoleResult = {
  status: 'assigned',
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
  staffAccessRequestStatus: null,
  staffAccessRequestRejectionReason: null,
  selectedRole: null,
  isProfileComplete: true,
  retry: vi.fn(),
};

const state = vi.hoisted(() => ({
  session: null as SessionRoleResult | null,
  searchParams: new URLSearchParams(),
  matrixProps: null as MatrixProps | null,
  checklistProps: null as ChecklistProps | null,
  router: {
    push: vi.fn(),
    replace: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => state.router,
  useSearchParams: () => state.searchParams,
}));

vi.mock('../../../_shell/session-role-context', () => ({
  useSharedSessionRole: () => state.session,
}));

vi.mock('@/features/submissions/components/submission-matrix-screen', () => ({
  SubmissionMatrixScreen: (props: MatrixProps) => {
    state.matrixProps = props;
    return <div>staff matrix</div>;
  },
}));

vi.mock('@/features/submissions/submission-checklist-page', () => ({
  SubmissionChecklistPage: (props: ChecklistProps) => {
    state.checklistProps = props;
    return <div>student checklist</div>;
  },
}));

import { DocumentsRoute } from './documents-route';

async function renderRoute(root: Root): Promise<void> {
  await act(async () => {
    root.render(<DocumentsRoute programId="program:basic" />);
  });
}

function matrixProps(): MatrixProps {
  if (state.matrixProps === null) throw new Error('matrix props missing');
  return state.matrixProps;
}

function checklistProps(): ChecklistProps {
  if (state.checklistProps === null) throw new Error('checklist props missing');
  return state.checklistProps;
}

describe('DocumentsRoute role boundary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    state.session = STAFF;
    state.searchParams = new URLSearchParams();
    state.matrixProps = null;
    state.checklistProps = null;
    state.router.push.mockReset();
    state.router.replace.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('교직원은 매트릭스만 마운트해 학생 조회도 시작하지 않는다', async () => {
    state.searchParams = new URLSearchParams('milestoneId=mid');
    await renderRoute(root);

    expect(container.textContent).toContain('staff matrix');
    expect(container.textContent).not.toContain('student checklist');
    expect(state.checklistProps).toBeNull();
    expect(matrixProps()).toMatchObject({
      programId: 'program:basic',
      selectedMilestoneId: 'mid',
    });
  });

  it('학생은 체크리스트만 마운트해 교직원 조회도 시작하지 않는다', async () => {
    state.session = STUDENT;
    state.searchParams = new URLSearchParams('milestoneId=final');
    await renderRoute(root);

    expect(container.textContent).toContain('student checklist');
    expect(container.textContent).not.toContain('staff matrix');
    expect(state.matrixProps).toBeNull();
    expect(checklistProps()).toMatchObject({
      programId: 'program:basic',
      milestoneId: 'final',
    });
  });

  it('교직원 단계 선택은 documents 주소의 milestoneId만 바꾼다', async () => {
    state.searchParams = new URLSearchParams('tab=overview');
    await renderRoute(root);

    matrixProps().onSelectMilestone('final/report');
    expect(state.router.replace).toHaveBeenCalledWith(
      '/programs/program%3Abasic/documents?tab=overview&milestoneId=final%2Freport',
      { scroll: false },
    );

    matrixProps().onSelectMilestone(null);
    expect(state.router.replace).toHaveBeenLastCalledWith(
      '/programs/program%3Abasic/documents?tab=overview',
      { scroll: false },
    );
  });

  it('학생 선택·닫기는 기존 push/replace 흐름을 documents 주소에서 보존한다', async () => {
    state.session = STUDENT;
    state.searchParams = new URLSearchParams('milestoneId=mid&tab=overview');
    await renderRoute(root);

    checklistProps().onSelectMilestone?.('final/report');
    expect(state.router.push).toHaveBeenCalledWith(
      '/programs/program%3Abasic/documents?milestoneId=final%2Freport&tab=overview',
      { scroll: false },
    );

    checklistProps().onCloseSelected?.();
    expect(state.router.replace).toHaveBeenCalledWith(
      '/programs/program%3Abasic/documents?tab=overview',
      { scroll: false },
    );
  });
});
