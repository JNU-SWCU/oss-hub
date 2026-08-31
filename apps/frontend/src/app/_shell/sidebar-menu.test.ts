import { describe, expect, it } from 'vitest';
import { ARCHIVE_CATEGORIES } from '@/features/archive/types';
import { PROGRAM_LIST_STATUS_LABELS } from '@/features/programs/types';
import { programDetailIdFromPathname, SECTION_FACETS } from './section-facets';
import type { MemberAccess } from './member-access';
import { STAFF_MENU, STUDENT_MENU } from './role-menus';
import {
  archiveSidebarGroup,
  isCurrentSidebarItem,
  programScopeBackHref,
  programScopeSidebarGroups,
  programSidebarGroup,
  rankingSidebarGroup,
  shellSectionFromPathname,
  sidebarBrandTitle,
  sidebarGroupsFor,
} from './sidebar-menu';

const STUDENT: MemberAccess = {
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
};
const STAFF: MemberAccess = {
  memberKind: 'STAFF',
  hasStaffAccess: true,
  hasAdminAccess: false,
};
const STAFF_ADMIN: MemberAccess = {
  memberKind: 'STAFF',
  hasStaffAccess: true,
  hasAdminAccess: true,
};

function dashboardHrefs(access: MemberAccess): readonly string[] {
  return sidebarGroupsFor('dashboard', access).flatMap((group) =>
    group.items.map((item) => item.href),
  );
}

describe('shellSectionFromPathname', () => {
  it('maps paths to sections', () => {
    expect(shellSectionFromPathname('/programs')).toBe('programs');
    expect(shellSectionFromPathname('/programs/new')).toBe('programs');
    expect(shellSectionFromPathname('/programs/x')).toBe('programs');
    expect(shellSectionFromPathname('/archive')).toBe('archive');
    expect(shellSectionFromPathname('/ranking')).toBe('ranking');
    expect(shellSectionFromPathname('/dashboard')).toBe('dashboard');
    expect(shellSectionFromPathname('/my-repos')).toBe('dashboard');
    expect(shellSectionFromPathname('/staff/dashboard')).toBeNull();
    expect(shellSectionFromPathname('/settings')).toBeNull();
  });
});

describe('sidebarGroupsFor (context)', () => {
  it('programs section only — no role menu mixed in', () => {
    const groups = sidebarGroupsFor('programs', STUDENT);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('프로그램 메뉴');
    expect(groups[0]?.items.map((i) => i.label)).toEqual([
      PROGRAM_LIST_STATUS_LABELS.all,
      PROGRAM_LIST_STATUS_LABELS.recruiting,
      PROGRAM_LIST_STATUS_LABELS.in_progress,
      PROGRAM_LIST_STATUS_LABELS.upcoming,
      PROGRAM_LIST_STATUS_LABELS.ended,
    ]);
  });

  it('program filters are flat peers with distinct icons', () => {
    const items = programSidebarGroup().items;
    expect(items.every((i) => (i.depth ?? 0) === 0)).toBe(true);
    expect(items.map((i) => i.label)).toEqual([
      PROGRAM_LIST_STATUS_LABELS.all,
      PROGRAM_LIST_STATUS_LABELS.recruiting,
      PROGRAM_LIST_STATUS_LABELS.in_progress,
      PROGRAM_LIST_STATUS_LABELS.upcoming,
      PROGRAM_LIST_STATUS_LABELS.ended,
    ]);
    const icons = items.map((i) => i.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('anonymous still sees programs menu', () => {
    expect(sidebarGroupsFor('programs', null)[0]?.items).toHaveLength(5);
  });

  it('dashboard section is role menus only including activity', () => {
    const groups = sidebarGroupsFor('dashboard', STUDENT);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('대시보드');
    expect(
      groups[0]?.items.map(({ label, href }) => ({ label, href })),
    ).toEqual(STUDENT_MENU);
    expect(groups[0]?.items.map((i) => i.href)).toContain(
      '/dashboard/activity',
    );
  });

  it('교직원 대시보드 메뉴는 운영·학생 활성·가입 신청을 보여 준다', () => {
    expect(STAFF_MENU).toEqual([
      { label: '운영 대시보드', href: '/dashboard' },
      { label: '학생 활성', href: '/dashboard/insights' },
      { label: '가입 신청', href: '/dashboard/applicants' },
    ]);
    const groups = sidebarGroupsFor('dashboard', STAFF);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('교직원');
    expect(groups[0]?.items).toHaveLength(3);
    expect(
      groups[0]?.items.map(({ label, href }) => ({ label, href })),
    ).not.toContainEqual({ label: '사용자 목록', href: '/admin/access' });
  });

  it('교직원·관리자 권한을 함께 가지면 두 그룹이고 입구는 /dashboard다', () => {
    const groups = sidebarGroupsFor('dashboard', STAFF_ADMIN);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.label).toBe('교직원');
    expect(
      groups[0]?.items.map(({ label, href }) => ({ label, href })),
    ).toEqual([
      { label: '운영 대시보드', href: '/dashboard' },
      { label: '학생 활성', href: '/dashboard/insights' },
      { label: '가입 신청', href: '/dashboard/applicants' },
    ]);
    expect(groups[1]?.label).toBe('관리자');
    expect(
      groups[1]?.items.map(({ label, href }) => ({ label, href })),
    ).toEqual([
      { label: '사용자 목록', href: '/admin/access' },
      { label: '감사 로그', href: '/dashboard/audit-logs' },
      { label: '시스템 상태', href: '/dashboard/system-status' },
    ]);
    expect(
      groups.flatMap((group) => group.items.map((item) => item.href)),
    ).not.toContain('/staff/dashboard');
  });

  it('관리자 시스템 상태 메뉴는 pulse 아이콘을 사용한다', () => {
    // Given: 교직원·관리자 권한을 함께 가진 회원.
    // When: 대시보드 그룹에서 시스템 상태 메뉴를 찾는다.
    const systemStatusItem = sidebarGroupsFor('dashboard', STAFF_ADMIN)
      .flatMap((group) => group.items)
      .find((item) => item.href === '/dashboard/system-status');
    // Then: 시스템 상태를 나타내는 pulse 아이콘을 사용한다.
    expect(systemStatusItem?.icon).toBe('pulse');
  });

  it.each([
    [
      'student-admin',
      { memberKind: 'STUDENT', hasStaffAccess: false, hasAdminAccess: true },
      [
        '/dashboard',
        '/my-repos',
        '/dashboard/activity',
        '/admin/access',
        '/dashboard/audit-logs',
        '/dashboard/system-status',
      ],
    ],
    [
      'staff-admin',
      STAFF_ADMIN,
      [
        '/dashboard',
        '/dashboard/insights',
        '/dashboard/applicants',
        '/admin/access',
        '/dashboard/audit-logs',
        '/dashboard/system-status',
      ],
    ],
    [
      'admin-only',
      { memberKind: null, hasStaffAccess: false, hasAdminAccess: true },
      ['/admin/access', '/dashboard/audit-logs', '/dashboard/system-status'],
    ],
  ] satisfies readonly [string, MemberAccess, readonly string[]][])(
    '%s surface를 권한 함축 없이 합집합으로 보인다',
    (_, access, expected) => {
      // Given: canonical 회원·권한 쌍.
      // When: 대시보드 그룹을 조립한다.
      const actual = dashboardHrefs(access);
      // Then: 정확히 그 합집합만 한 번씩 노출된다.
      expect(actual).toEqual(expected);
    },
  );

  it('교직원 회원이어도 교직원 권한이 없으면 운영 메뉴가 없다', () => {
    // Given: 승인 대기·회수로 권한만 빠진 STAFF 회원.
    const pendingStaff: MemberAccess = {
      memberKind: 'STAFF',
      hasStaffAccess: false,
      hasAdminAccess: false,
    };
    // When / Then: 열어 줄 업무 메뉴가 없다.
    expect(dashboardHrefs(pendingStaff)).toEqual([]);
  });

  it('dashboard without access is empty', () => {
    expect(sidebarGroupsFor('dashboard', null)).toEqual([]);
  });

  it('dashboard brand stays 대시보드 when group labels are role names', () => {
    const adminGroups = sidebarGroupsFor('dashboard', STAFF_ADMIN);
    const staffGroups = sidebarGroupsFor('dashboard', STAFF);
    expect(sidebarBrandTitle('dashboard', adminGroups)).toBe('대시보드');
    expect(sidebarBrandTitle('dashboard', staffGroups)).toBe('대시보드');
    expect(
      sidebarBrandTitle('programs', sidebarGroupsFor('programs', null)),
    ).toBe('프로그램 메뉴');
  });

  it('교직원 메뉴에 관리자 경로가 없다', () => {
    const hrefs = dashboardHrefs(STAFF);
    expect(hrefs.every((href) => !href.startsWith('/admin/'))).toBe(true);
  });

  it('no practice competition item', () => {
    const labels = programSidebarGroup()
      .items.map((i) => i.label)
      .join(' ');
    expect(labels).not.toContain('연습');
  });

  it('archive section is flat with distinct category icons', () => {
    const groups = sidebarGroupsFor('archive', null);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('공개 아카이브');
    const items = groups[0]?.items ?? [];
    expect(items).toHaveLength(1 + ARCHIVE_CATEGORIES.length);
    expect(items.every((i) => (i.depth ?? 0) === 0)).toBe(true);
    expect(items[0]).toMatchObject({
      label: '전체',
      href: '/archive',
      icon: 'archive',
    });
    expect(items.some((i) => i.href === '/archive?category=CAPSTONE')).toBe(
      true,
    );
    const categoryIcons = items.slice(1).map((i) => i.icon);
    expect(new Set(categoryIcons).size).toBe(categoryIcons.length);
  });

  it('archive counts inject badges', () => {
    const group = archiveSidebarGroup({
      all: 3,
      BASIC: 1,
      CAPSTONE: 2,
    });
    expect(group.items[0]?.count).toBe(3);
    expect(
      group.items.find((i) => i.href === '/archive?category=CAPSTONE')?.count,
    ).toBe(2);
  });

  it('ranking section: 전체 + years as flat peers', () => {
    const groups = sidebarGroupsFor('ranking', null, {
      rankingYears: [2026, 2025],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('랭킹');
    expect(
      groups[0]?.items.map((i) => ({
        label: i.label,
        href: i.href,
        depth: i.depth,
      })),
    ).toEqual([
      { label: '전체', href: '/ranking?year=all', depth: 0 },
      { label: '2026', href: '/ranking?year=2026', depth: 0 },
      { label: '2025', href: '/ranking?year=2025', depth: 0 },
    ]);
  });

  it('ranking without years still has 전체', () => {
    const items = rankingSidebarGroup().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe('전체');
  });
});

describe('isCurrentSidebarItem', () => {
  it('program status query', () => {
    expect(isCurrentSidebarItem('/programs', '/programs', '')).toBe(true);
    expect(
      isCurrentSidebarItem(
        '/programs',
        '/programs?status=recruiting',
        'status=recruiting',
      ),
    ).toBe(true);
  });

  it('program detail does not highlight filters', () => {
    expect(isCurrentSidebarItem('/programs/x', '/programs', '')).toBe(false);
  });

  it('archive category query', () => {
    expect(isCurrentSidebarItem('/archive', '/archive', '')).toBe(true);
    expect(
      isCurrentSidebarItem(
        '/archive',
        '/archive?category=CAPSTONE',
        'category=CAPSTONE',
      ),
    ).toBe(true);
    expect(
      isCurrentSidebarItem(
        '/archive',
        '/archive?category=CAPSTONE',
        'category=BASIC',
      ),
    ).toBe(false);
  });

  it('ranking year query', () => {
    expect(
      isCurrentSidebarItem('/ranking', '/ranking?year=2025', 'year=2025'),
    ).toBe(true);
    expect(isCurrentSidebarItem('/ranking', '/ranking?year=2025', '')).toBe(
      false,
    );
    expect(isCurrentSidebarItem('/ranking', '/ranking', 'year=2025')).toBe(
      false,
    );
  });

  /**
   * `/ranking` 은 `year` 가 없어도 **올해**를 보여 준다
   * (ADR-010 §1, `parseRankingYearSearchParam`).
   *
   * 강조가 「전체」로 가면 사이드바는 전체라고 말하는데 표는 올해 수치를 낸다.
   * 게다가 그 「전체」 링크(`?year=all`)를 실제로 누르면 다른 표가 나온다 —
   * 같은 메뉴가 어디서 왔느냐에 따라 다른 결과를 보이는 셈이다.
   */
  it('/ranking 은 전체가 아니라 올해 항목을 강조한다', () => {
    const thisYear = String(new Date().getFullYear());

    expect(isCurrentSidebarItem('/ranking', '/ranking?year=all', '')).toBe(
      false,
    );
    expect(
      isCurrentSidebarItem('/ranking', `/ranking?year=${thisYear}`, ''),
    ).toBe(true);
    // 명시적 전체는 그대로 전체를 강조한다.
    expect(
      isCurrentSidebarItem('/ranking', '/ranking?year=all', 'year=all'),
    ).toBe(true);
  });

  it('archive detail does not highlight filters', () => {
    expect(isCurrentSidebarItem('/archive/123', '/archive', '')).toBe(false);
    expect(
      isCurrentSidebarItem('/archive/123', '/archive?category=CAPSTONE', ''),
    ).toBe(false);
  });

  it('회원 공통 홈 메뉴는 /dashboard에서만 강조된다', () => {
    expect(isCurrentSidebarItem('/dashboard', '/dashboard', '')).toBe(true);
    expect(isCurrentSidebarItem('/staff/dashboard', '/dashboard', '')).toBe(
      false,
    );
    expect(isCurrentSidebarItem('/admin/access', '/dashboard', '')).toBe(false);
    expect(
      isCurrentSidebarItem('/admin/access/users/u1', '/dashboard', ''),
    ).toBe(false);
    expect(isCurrentSidebarItem('/admin/access', '/admin/access', '')).toBe(
      true,
    );
    // 별 사이드 항목 — 홈의 자식으로 취급하지 않는다
    expect(isCurrentSidebarItem('/dashboard/activity', '/dashboard', '')).toBe(
      false,
    );
    expect(
      isCurrentSidebarItem(
        '/dashboard/applicants',
        '/dashboard/applicants',
        '',
      ),
    ).toBe(true);
    expect(
      isCurrentSidebarItem(
        '/dashboard/applicants/users/u1',
        '/dashboard/applicants',
        '',
      ),
    ).toBe(true);
    expect(
      isCurrentSidebarItem('/dashboard/applicants', '/dashboard', ''),
    ).toBe(false);
    expect(isCurrentSidebarItem('/my-repos', '/dashboard', '')).toBe(false);
  });
});

describe('SECTION_FACETS registry (U4)', () => {
  it('ranking.items(undefined) returns only 전체', () => {
    const items = SECTION_FACETS.ranking?.items(undefined) ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe('전체');
    expect(items[0]?.href).toBe('/ranking?year=all');
  });

  it('registry params match peer-filter keys', () => {
    expect(SECTION_FACETS.programs?.param).toBe('status');
    expect(SECTION_FACETS.archive?.param).toBe('category');
    expect(SECTION_FACETS.ranking?.param).toBe('year');
    expect(SECTION_FACETS.dashboard).toBeUndefined();
  });
});

describe('programDetailIdFromPathname', () => {
  it('list root (with or without query-relevant path) is not a detail scope', () => {
    expect(programDetailIdFromPathname('/programs')).toBeNull();
  });

  it('static /programs/new is section-scoped, not program detail scope', () => {
    expect(programDetailIdFromPathname('/programs/new')).toBeNull();
  });

  it('detail id and nested detail sub-paths resolve the same id', () => {
    expect(programDetailIdFromPathname('/programs/prog-1')).toBe('prog-1');
    expect(programDetailIdFromPathname('/programs/prog-1/teams')).toBe(
      'prog-1',
    );
    expect(programDetailIdFromPathname('/programs/prog-1/board')).toBe(
      'prog-1',
    );
  });

  it('decodes encoded ids (seed ids contain `:`)', () => {
    expect(programDetailIdFromPathname('/programs/seed%3A1')).toBe('seed:1');
  });

  it('other sections are not program detail scope', () => {
    expect(programDetailIdFromPathname('/archive/1')).toBeNull();
    expect(programDetailIdFromPathname('/dashboard')).toBeNull();
  });
});

describe('programScopeBackHref', () => {
  it('역할과 무관하게 프로그램 목록으로 보낸다', () => {
    expect(programScopeBackHref()).toBe('/programs');
  });
});

describe('programScopeSidebarGroups', () => {
  const base = {
    programId: 'prog-1',
    teamCount: 47,
    boardPostCount: 3,
  } as const;

  it('STUDENT view: 내 제출물 parent with completed/total, no 서류 현황', () => {
    const groups = programScopeSidebarGroups({
      ...base,
      viewerRole: 'STUDENT',
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
    expect(groups).toHaveLength(3);
    const [overview, documents, board] = groups;
    expect(overview?.items.map((i) => i.label)).toEqual([
      '프로그램 개요',
      '참여 팀',
    ]);
    expect(overview?.items[1]?.count).toBe('47');
    // 학생은 신청 판정 창구가 없다 — 개요 그룹에 「신청자」를 붙이지 않는다.
    expect(overview?.items.some((i) => i.label === '신청자')).toBe(false);
    expect(documents?.items[0]).toMatchObject({
      label: '내 제출물',
      count: '2/6',
      depth: 0,
    });
    expect(documents?.items[1]).toMatchObject({
      label: '프로젝트 계획서 제출',
      count: '2/3',
      depth: 1,
    });
    expect(documents?.items.some((i) => i.label === '서류 현황')).toBe(false);
    expect(board?.items[0]).toMatchObject({ label: '게시판', count: '3' });
  });

  it('STAFF view: 서류 현황 parent has no count; child count is team-based', () => {
    const groups = programScopeSidebarGroups({
      ...base,
      viewerRole: 'STAFF',
      milestoneDocuments: [
        {
          milestoneId: 'm3',
          title: '프로젝트 계획서 제출',
          completed: 2,
          total: 3,
        },
        {
          milestoneId: 'm4',
          title: '1차 중간 산출물 제출',
          completed: 0,
          total: 3,
        },
      ],
    });
    const overview = groups[0];
    // 승인·반려 입구 — 참여 팀만 있으면 판정 화면에 도달하지 못한다.
    expect(overview?.items.map((i) => i.label)).toEqual([
      '프로그램 개요',
      '참여 팀',
      '신청자',
    ]);
    expect(overview?.items[2]).toMatchObject({
      label: '신청자',
      href: '/programs/prog-1/applicants',
    });
    const documents = groups[1];
    expect(documents?.items[0]?.label).toBe('서류 현황');
    expect(documents?.items[0]?.count).toBeUndefined();
    expect(documents?.items[1]).toMatchObject({
      label: '프로젝트 계획서 제출',
      count: '2/47팀',
    });
    expect(documents?.items[2]).toMatchObject({
      label: '1차 중간 산출물 제출',
      count: '0/47팀',
    });
    expect(documents?.items.some((i) => i.label === '내 제출물')).toBe(false);
  });

  it('ADMIN viewer is treated as staff view', () => {
    const groups = programScopeSidebarGroups({ ...base, viewerRole: 'ADMIN' });
    expect(groups[0]?.items.some((i) => i.label === '신청자')).toBe(true);
    expect(groups[1]?.items[0]?.label).toBe('서류 현황');
  });

  it('no milestone documents means parent-only, no children', () => {
    const groups = programScopeSidebarGroups({
      ...base,
      viewerRole: 'STAFF',
    });
    expect(groups[1]?.items).toHaveLength(1);
  });

  it('hrefs are namespaced under the program id', () => {
    const groups = programScopeSidebarGroups({
      ...base,
      viewerRole: 'STUDENT',
    });
    expect(groups[0]?.items[0]?.href).toBe('/programs/prog-1');
    expect(groups[0]?.items[1]?.href).toBe('/programs/prog-1/teams');
    expect(groups[2]?.items[0]?.href).toBe('/programs/prog-1/board');
  });
});
