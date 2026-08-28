import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

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

  it('does not mark a milestone-doc child as current even when its href matches the path', () => {
    const html = render({ pathname: '/programs/prog-1/mydocs' });
    // parent 내 제출물 item is current, but the depth-1 child sharing the same href must not be
    const currentCount = (html.match(/aria-current="page"/g) ?? []).length;
    expect(currentCount).toBe(1);
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
