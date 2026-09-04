import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    scroll,
    ...rest
  }: {
    href: string;
    children?: React.ReactNode;
    scroll?: boolean;
  }) => (
    <a
      href={href}
      data-scroll={scroll === false ? 'false' : undefined}
      {...rest}
    >
      {children}
    </a>
  ),
}));

import { ProgramScopeSidebar } from './program-scope-sidebar';
import { programScopeSidebarGroups } from './sidebar-menu';

const studentGroups = programScopeSidebarGroups({
  programId: 'prog-1',
  viewerRole: 'STUDENT',
  teamCount: 47,
  boardPostCount: 3,
  viewerDocuments: { completed: 2, total: 6 },
  milestoneDocuments: [
    {
      milestoneId: 'm3',
      title: '프로젝트 계획서 제출',
      completed: 2,
      total: 3,
    },
  ],
  milestones: [
    {
      milestoneId: 'm3',
      title: '프로젝트 계획서 제출',
      submissionEnabled: true,
    },
  ],
});

const staffGroups = programScopeSidebarGroups({
  programId: 'prog-1',
  viewerRole: 'STAFF',
  teamCount: 47,
  boardPostCount: 3,
  milestoneDocuments: [
    {
      milestoneId: 'm3',
      title: '프로젝트 계획서 제출',
      completed: 2,
      total: 3,
    },
  ],
});

function render(
  overrides: Partial<React.ComponentProps<typeof ProgramScopeSidebar>> = {},
) {
  return renderToStaticMarkup(
    <ProgramScopeSidebar
      programName="2026-2 오픈소스 SW 프로젝트"
      groups={studentGroups}
      pathname="/programs/prog-1"
      search=""
      collapsed={false}
      onToggle={() => {}}
      backHref="/programs"
      {...overrides}
    />,
  );
}

describe('ProgramScopeSidebar', () => {
  it('is desktop-only, same shell as AppSidebar', () => {
    const html = render();
    expect(html).toContain('hidden min-[900px]:flex');
    expect(html).not.toContain('sticky');
    expect(html).not.toContain('100dvh-3.5rem');
    expect(html).toContain('min-h-0');
    expect(html).toContain('overflow-hidden');
  });

  it('shows the back link and program title instead of an eyebrow group label', () => {
    const html = render();
    expect(html).toContain('‹ 프로그램 목록');
    expect(html).toContain('href="/programs"');
    expect(html).toContain('2026-2 오픈소스 SW 프로젝트');
  });

  it('respects a custom backHref', () => {
    const html = render({ backHref: '/programs?status=in_progress' });
    expect(html).toContain('href="/programs?status=in_progress"');
  });

  it('renders overview/teams, 내 제출물 with fraction badge, and board with count', () => {
    const html = render();
    expect(html).toContain('프로그램 개요');
    expect(html).toContain('href="/programs/prog-1"');
    expect(html).toContain('참여 팀');
    expect(html).toContain('href="/programs/prog-1/teams"');
    expect(html).toContain('>47<');
    expect(html).toContain('내 제출물');
    expect(html).toContain('>2/6<');
    expect(html).not.toContain('서류 현황');
    expect(html).toContain('게시판');
    expect(html).toContain('>3<');
  });

  it('renders staff 서류 현황 without a count and team-based child counts', () => {
    const html = renderToStaticMarkup(
      <ProgramScopeSidebar
        programName="2026-2 오픈소스 SW 프로젝트"
        groups={staffGroups}
        pathname="/programs/prog-1"
        search=""
        collapsed={false}
        onToggle={() => {}}
        backHref="/programs"
      />,
    );
    expect(html).toContain('서류 현황');
    expect(html).not.toContain('내 제출물');
    expect(html).toContain('프로젝트 계획서 제출');
    expect(html).toContain('>2/47팀<');
    // 교직원 스코프에는 신청 판정 입구가 사이드바에 있어야 한다.
    expect(html).toContain('신청자');
    expect(html).toContain('href="/programs/prog-1/applicants"');
  });

  it('applicants page highlights the 신청자 item', () => {
    const html = renderToStaticMarkup(
      <ProgramScopeSidebar
        programName="2026-2 오픈소스 SW 프로젝트"
        groups={staffGroups}
        pathname="/programs/prog-1/applicants"
        search=""
        collapsed={false}
        onToggle={() => {}}
        backHref="/programs"
      />,
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/programs/prog-1/applicants"');
  });

  it('indents depth-1 milestone children and marks them via data-depth', () => {
    const html = render();
    expect(html).toContain('data-depth="1"');
    expect(html).toContain('data-depth="0"');
  });

  it('current marker highlights the overview item on the program detail path, not children', () => {
    const html = render({ pathname: '/programs/prog-1' });
    expect(html).toContain('program-scope-sidebar-current-marker');
    expect(html).toContain('aria-current="page"');
  });

  it('keeps the documents parent current while marking only the focused milestone child as selected', () => {
    const html = render({
      pathname: '/programs/prog-1/documents',
      search: 'milestoneId=m3',
    });
    const currentCount = (html.match(/aria-current="page"/g) ?? []).length;
    expect(currentCount).toBe(1);
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('data-slot="program-scope-sidebar-selection"');
    expect(html).toContain('>선택됨</span>');
  });

  it('selects 모든 단계 when staff opens documents without milestoneId', () => {
    const html = render({
      groups: staffGroups,
      pathname: '/programs/prog-1/documents',
      search: '',
    });

    expect(html).toMatch(
      /href="\/programs\/prog-1\/documents"[^>]*data-selected="true"[^>]*data-depth="1"[^>]*>[\s\S]*?모든 단계[\s\S]*?선택됨[\s\S]*?<\/a>/,
    );
  });

  it('selects the matching milestone and preserves scroll for every stage link', () => {
    const html = render({
      groups: staffGroups,
      pathname: '/programs/prog-1/documents',
      search: 'milestoneId=m3',
    });

    expect(html).toMatch(
      /href="\/programs\/prog-1\/documents\?milestoneId=m3"[^>]*data-selected="true"[^>]*>[\s\S]*?프로젝트 계획서 제출[\s\S]*?선택됨[\s\S]*?<\/a>/,
    );
    expect(html.match(/data-scroll="false"/g)).toHaveLength(2);
  });

  it('단계를 바꿔도 milestoneId 이외의 기존 쿼리를 보존한다', () => {
    const html = render({
      groups: staffGroups,
      pathname: '/programs/prog-1/documents',
      search: 'tab=overview&milestoneId=m3',
    });

    expect(html).toContain('href="/programs/prog-1/documents?tab=overview"');
    expect(html).toContain(
      'href="/programs/prog-1/documents?tab=overview&amp;milestoneId=m3"',
    );
  });

  it('단계 목록 조회 실패에는 새로고침 대신 바로 다시 시도할 행동을 준다', () => {
    const html = render({ milestoneNavigationFailed: true });

    expect(html).toContain('role="alert"');
    expect(html).toContain('단계 목록을 불러오지 못했습니다.');
    expect(html).toContain('다시 불러오기');
  });

  it('falls back to 모든 단계 for an unknown milestoneId without selecting another stage', () => {
    const html = render({
      groups: staffGroups,
      pathname: '/programs/prog-1/documents',
      search: 'milestoneId=unknown',
    });

    expect(html).toMatch(
      /href="\/programs\/prog-1\/documents"[^>]*data-selected="true"[^>]*data-depth="1"[^>]*>[\s\S]*?모든 단계[\s\S]*?선택됨[\s\S]*?<\/a>/,
    );
    expect(html).not.toMatch(/milestoneId=m3"[^>]*data-selected="true"/);
  });

  it('teams page highlights the 참여 팀 item', () => {
    const html = render({ pathname: '/programs/prog-1/teams' });
    expect(html).toContain('aria-current="page"');
  });

  it('renders the countdown block only when expanded and remaining milestones are loaded', () => {
    const withCountdown = render({
      remainingMilestones: [
        {
          label: '주제 선정 · 저장소 연결',
          dueAt: '2026-09-12T18:00:00+09:00',
        },
      ],
    });
    expect(withCountdown).toContain('data-slot="program-countdown"');

    const endedSchedule = render({ remainingMilestones: [] });
    expect(endedSchedule).toContain('data-slot="program-countdown"');

    const withoutCountdown = render({ remainingMilestones: undefined });
    expect(withoutCountdown).not.toContain('data-slot="program-countdown"');

    const collapsedWithCountdown = render({
      collapsed: true,
      remainingMilestones: [
        {
          label: '주제 선정 · 저장소 연결',
          dueAt: '2026-09-12T18:00:00+09:00',
        },
      ],
    });
    expect(collapsedWithCountdown).not.toContain(
      'data-slot="program-countdown"',
    );
  });

  it('keeps the institution footer', () => {
    const html = render();
    expect(html).toContain('전남대학교');
    expect(html).toContain('SW중심대학사업단');
  });

  it('collapsed hides labels and count badges but exposes them via aria-label', () => {
    const html = render({ collapsed: true });
    expect(html).not.toContain('data-slot="program-scope-sidebar-count"');
    expect(html).toContain('aria-label="참여 팀 47"');
    expect(html).toContain('aria-label="내 제출물 2/6"');
  });
});

describe('ProgramScopeSidebar — 참여자 전용 항목 잠금(#1099)', () => {
  const lockedGroups = programScopeSidebarGroups({
    programId: 'prog-1',
    viewerRole: 'STUDENT',
    teamCount: 47,
    boardPostCount: 3,
    viewerParticipant: false,
    viewerDocuments: { completed: 0, total: 2 },
    milestones: [
      {
        milestoneId: 'm3',
        title: '프로젝트 계획서 제출',
        submissionEnabled: true,
      },
    ],
    milestoneDocuments: [
      {
        milestoneId: 'm3',
        title: '프로젝트 계획서 제출',
        completed: 0,
        total: 3,
      },
    ],
  });

  function renderLocked(
    overrides: Partial<React.ComponentProps<typeof ProgramScopeSidebar>> = {},
  ) {
    return render({ groups: lockedGroups, ...overrides });
  }

  it('메뉴는 그대로 보이되 링크가 아니다', () => {
    const html = renderLocked();

    expect(html).toContain('내 제출물');
    expect(html).toContain('게시판');
    expect(html).not.toContain('href="/programs/prog-1/documents"');
    expect(html).not.toContain('href="/programs/prog-1/board"');
    // 잠기지 않은 항목은 그대로 링크다.
    expect(html).toContain('href="/programs/prog-1/teams"');
  });

  it('잠금 딱지는 「승인 후」다 — 신청만으로는 열리지 않는다', () => {
    const html = renderLocked();

    expect(html).toContain('data-slot="program-scope-sidebar-locked"');
    expect(html).toContain('>승인 후</span>');
    expect((html.match(/>승인 후<\/span>/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-disabled="true"');
  });

  it('주소를 직접 입력해 들어와도 좌측 패널은 현재 위치를 그대로 알린다', () => {
    const html = renderLocked({ pathname: '/programs/prog-1/documents' });

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('program-scope-sidebar-current-marker');
  });

  it('접힌 레일에서도 잠금 문구가 읽는 도구에 남는다', () => {
    const html = renderLocked({ collapsed: true });

    expect(html).toContain('승인 후');
    expect(html).toContain('내 제출물');
  });
});
