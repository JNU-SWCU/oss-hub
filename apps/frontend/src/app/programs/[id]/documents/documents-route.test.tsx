import { act, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { createListScreenRoot as createRoot } from '../../../../../test-support/list-screen-root';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoleResult } from '../../../_shell/use-session-role';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

type MatrixProps = {
  readonly headerActions?: ReactNode;
  readonly programId: string;
};

type CollectionProps = {
  readonly headerActions?: ReactNode;
  readonly programId: string;
  readonly milestoneId: string;
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
  collectionProps: null as CollectionProps | null,
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
    return <div>staff matrix{props.headerActions}</div>;
  },
}));

vi.mock('../requirement-checklist', () => ({
  RequirementChecklistPage: (props: ChecklistProps) => {
    state.checklistProps = props;
    return <div>student checklist</div>;
  },
}));

vi.mock('@/features/programs/documents/requirement-collection-screen', () => ({
  RequirementCollectionScreen: (props: CollectionProps) => {
    state.collectionProps = props;
    return <div>staff collection{props.headerActions}</div>;
  },
}));

import { ProgramViewContext } from '../../../_shell/program-shell-policy';
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

function collectionProps(): CollectionProps {
  if (state.collectionProps === null) {
    throw new Error('collection props missing');
  }
  return state.collectionProps;
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
    state.collectionProps = null;
    state.checklistProps = null;
    state.router.push.mockReset();
    state.router.replace.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('교직원의 단계 없는 화면은 매트릭스만 마운트해 학생 조회도 시작하지 않는다', async () => {
    await renderRoute(root);

    expect(container.textContent).toContain('staff matrix');
    expect(container.textContent).not.toContain('student checklist');
    expect(state.checklistProps).toBeNull();
    expect(state.collectionProps).toBeNull();
    expect(matrixProps()).toMatchObject({ programId: 'program:basic' });
  });

  it('교직원이 단계를 고르면 같은 주소에서 서류 수합표를 열고 매트릭스는 닫는다', async () => {
    state.searchParams = new URLSearchParams('milestoneId=mid');
    await renderRoute(root);

    expect(container.textContent).toContain('staff collection');
    expect(container.textContent).not.toContain('staff matrix');
    expect(container.textContent).not.toContain('student checklist');
    expect(state.matrixProps).toBeNull();
    expect(collectionProps()).toMatchObject({
      programId: 'program:basic',
      milestoneId: 'mid',
    });
    expect(collectionProps().headerActions).not.toBeUndefined();
  });

  it('학생은 체크리스트만 마운트해 교직원 조회도 시작하지 않는다', async () => {
    state.session = STUDENT;
    state.searchParams = new URLSearchParams('milestoneId=final');
    await renderRoute(root);

    expect(container.textContent).toContain('student checklist');
    expect(container.textContent).not.toContain('staff matrix');
    expect(container.textContent).not.toContain('staff collection');
    expect(state.matrixProps).toBeNull();
    expect(state.collectionProps).toBeNull();
    expect(checklistProps()).toMatchObject({
      programId: 'program:basic',
      milestoneId: 'final',
    });
  });

  it('겸권한 참여 학생의 기본 화면에는 자기 제출 체크리스트만 열린다', async () => {
    state.session = { ...STUDENT, hasStaffAccess: true, hasAdminAccess: true };
    await act(async () =>
      root.render(
        <ProgramViewContext.Provider value="STUDENT">
          <DocumentsRoute programId="program:basic" />
        </ProgramViewContext.Provider>,
      ),
    );
    expect(container.textContent).toContain('student checklist');
    expect(state.matrixProps).toBeNull();
  });

  it.each([
    ['교직원 접근', { hasStaffAccess: true, hasAdminAccess: false }],
    ['관리자 접근', { hasStaffAccess: false, hasAdminAccess: true }],
  ])('%s이 있어도 학생은 자기 제출물만 본다', async (_label, access) => {
    state.session = { ...STUDENT, ...access };
    await act(async () => {
      root.render(
        <ProgramViewContext.Provider value={null}>
          <DocumentsRoute programId="program:basic" />
        </ProgramViewContext.Provider>,
      );
    });

    expect(state.checklistProps?.programId).toBe('program:basic');
    expect(state.matrixProps).toBeNull();
  });

  it('저장된 운영 화면 선택은 학생에게 교직원 업무를 열지 않는다', async () => {
    state.session = { ...STUDENT, hasStaffAccess: true };
    state.searchParams = new URLSearchParams('view=operations');
    await act(async () =>
      root.render(
        <ProgramViewContext.Provider value="STAFF">
          <DocumentsRoute programId="program:basic" />
        </ProgramViewContext.Provider>,
      ),
    );
    expect(container.textContent).toContain('student checklist');
    expect(state.matrixProps).toBeNull();
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
