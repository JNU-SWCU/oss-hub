// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramOverview } from '@/features/programs/program-overview-api';
import type { AppRole } from './role';
import type { SessionStatus } from './use-session-role';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useSessionRole: vi.fn(),
  getProgramOverview: vi.fn(),
  getProgramNavigationMilestones: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
  useSearchParams: mocks.useSearchParams,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('./use-session-role', () => ({ useSessionRole: mocks.useSessionRole }));
vi.mock('@/features/programs/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));
vi.mock('@/features/programs/program-navigation-api', () => ({
  getProgramNavigationMilestones: mocks.getProgramNavigationMilestones,
}));

import { ProductShell } from './product-shell';

function mockSession(
  overrides: {
    readonly status?: SessionStatus;
    readonly role?: AppRole | null;
    readonly isProfileComplete?: boolean;
  } = {},
) {
  const role = overrides.role ?? 'STAFF';
  mocks.useSessionRole.mockReturnValue({
    status: overrides.status ?? 'assigned',
    role,
    staffAccessRequestStatus: null,
    selectedRole: null,
    memberKind: role === 'STAFF' || role === 'ADMIN' ? 'STAFF' : 'STUDENT',
    hasStaffAccess: role === 'STAFF' || role === 'ADMIN',
    hasAdminAccess: role === 'ADMIN',
    isProfileComplete: overrides.isProfileComplete ?? true,
    retry: () => {},
  });
}

function overview(
  remainingMilestones: ProgramOverview['remainingMilestones'],
): ProgramOverview {
  return {
    programId: 'prog-1',
    name: '2026 하계 SW 현장실습 연계 프로그램',
    category: '오픈소스 SW 개발 사업단',
    lifecycle: '모집마감',
    milestoneCount: 3,
    boardPostCount: 1,
    participantCount: 2,
    teamCount: 1,
    connectedRepositoryCount: 0,
    viewerRole: 'STAFF',
    viewerDocumentsCompleted: null,
    viewerDocumentsTotal: null,
    fullySubmittedParticipantCount: 1,
    remainingMilestones,
    milestoneDocuments: [],
  };
}

async function renderShell(
  root: Root,
  options: { readonly initialCollapsed?: boolean } = {},
) {
  await act(async () => {
    root.render(
      <ProductShell initialCollapsed={options.initialCollapsed}>
        <p>본문</p>
      </ProductShell>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('ProductShell program deadline countdown', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T04:42:39.000Z'));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mocks.usePathname.mockReturnValue('/programs/prog-1');
    mocks.useSearchParams.mockReturnValue(new URLSearchParams());
    mockSession();
    mocks.getProgramOverview.mockReset();
    mocks.getProgramNavigationMilestones.mockReset();
    mocks.getProgramNavigationMilestones.mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('keeps the deadline block hidden while the overview is unavailable', async () => {
    mocks.getProgramOverview.mockReturnValue(new Promise(() => {}));

    await renderShell(root);

    expect(container.innerHTML).not.toContain('data-slot="program-countdown"');
    expect(container.textContent).not.toContain('마감 일정이 종료되었습니다.');
  });

  it('renders every loaded remaining milestone through the program sidebar', async () => {
    mocks.getProgramOverview.mockResolvedValue(
      overview([
        {
          label: '프로젝트 계획서 제출',
          dueAt: '2026-09-12T18:00:00+09:00',
        },
        {
          label: '최종 발표 및 시연',
          dueAt: '2026-09-19T18:00:00+09:00',
        },
      ]),
    );

    await renderShell(root);

    expect(container.innerHTML).toContain('data-slot="program-countdown"');
    expect(container.textContent).toContain('프로젝트 계획서 제출');
    expect(container.textContent).toContain('최종 발표 및 시연');
    expect(container.textContent).toContain('2026.09.12 (토) 18:00');
    expect(container.textContent).not.toContain('마감 일정이 종료되었습니다.');
  });

  it('passes a loaded empty schedule through as the ended state', async () => {
    mocks.getProgramOverview.mockResolvedValue(overview([]));

    await renderShell(root);

    expect(container.innerHTML).toContain('data-slot="program-countdown"');
    expect(container.textContent).toContain('마감 일정이 종료되었습니다.');
  });

  it('keeps the product shell available when a deadline date is invalid', async () => {
    mocks.getProgramOverview.mockResolvedValue(
      overview([{ label: '잘못된 마감', dueAt: 'invalid-date' }]),
    );

    await renderShell(root);

    expect(container.textContent).toContain('본문');
    expect(container.textContent).toContain('마감 일정을 표시할 수 없습니다.');
  });

  it('does not mount the deadline block while the program sidebar is collapsed', async () => {
    mocks.getProgramOverview.mockResolvedValue(
      overview([
        {
          label: '프로젝트 계획서 제출',
          dueAt: '2026-09-12T18:00:00+09:00',
        },
      ]),
    );

    await renderShell(root, { initialCollapsed: true });

    expect(container.innerHTML).not.toContain('data-slot="program-countdown"');
    expect(container.textContent).not.toContain('프로젝트 계획서 제출');
  });
});
