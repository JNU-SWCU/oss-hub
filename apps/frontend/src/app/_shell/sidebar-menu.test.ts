import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROGRAM_LIST_STATUS_LABELS } from '@/features/programs/types';
import { currentRankingYear } from '@/features/ranking/types';
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

  it('대시보드 하위 사용자 화면을 대시보드 섹션으로 인식한다', () => {
    // Given: 대시보드 아래로 이전된 사용자 화면 경로.
    const pathname = '/dashboard/users';

    // When: 현재 경로가 속한 셸 섹션을 판별한다.
    const section = shellSectionFromPathname(pathname);

    // Then: 대시보드 좌측 메뉴가 선택된다.
    expect(section).toBe('dashboard');
  });

  it('역할을 드러내던 옛 경로를 셸 섹션으로 인식하지 않는다', () => {
    // Given: 제거된 역할 접두사 아래의 접근 관리 경로.
    const pathname = ['', 'admin', 'access'].join('/');

    // When: 현재 경로가 속한 셸 섹션을 판별한다.
    const section = shellSectionFromPathname(pathname);

    // Then: 존재하지 않는 경로에 대시보드 선택 상태를 부여하지 않는다.
    expect(section).toBeNull();
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
    ).not.toContainEqual({ label: '사용자 목록', href: '/dashboard/users' });
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
      { label: '사용자 목록', href: '/dashboard/users' },
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
        '/dashboard/users',
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
        '/dashboard/users',
        '/dashboard/audit-logs',
        '/dashboard/system-status',
      ],
    ],
    [
      'admin-only',
      { memberKind: null, hasStaffAccess: false, hasAdminAccess: true },
      ['/dashboard/users', '/dashboard/audit-logs', '/dashboard/system-status'],
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

  it('교직원 업무 링크는 역할을 드러내지 않는 대시보드 경로를 사용한다', () => {
    // Given: 교직원 권한으로 볼 수 있는 대시보드 메뉴.
    const hrefs = dashboardHrefs(STAFF);

    // When / Then: 모든 링크가 공통 대시보드 입구 아래에 있다.
    expect(
      hrefs.every(
        (href) => href === '/dashboard' || href.startsWith('/dashboard/'),
      ),
    ).toBe(true);
  });

  it('no practice competition item', () => {
    const labels = programSidebarGroup()
      .items.map((i) => i.label)
      .join(' ');
    expect(labels).not.toContain('연습');
  });

  it('archive section: 전체 + years as flat peers', () => {
    const groups = sidebarGroupsFor('archive', null, {
      archiveYears: [2026, 2025],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('공개 아카이브');
    const items = groups[0]?.items ?? [];
    expect(items).toHaveLength(3);
    expect(items.every((i) => (i.depth ?? 0) === 0)).toBe(true);
    expect(
      items.map((i) => ({ label: i.label, href: i.href, depth: i.depth })),
    ).toEqual([
      { label: '전체', href: '/archive', depth: 0 },
      { label: '2026', href: '/archive?year=2026', depth: 0 },
      { label: '2025', href: '/archive?year=2025', depth: 0 },
    ]);
    expect(items[0]).toMatchObject({
      label: '전체',
      href: '/archive',
      icon: 'archive',
    });
  });

  it('archive sidebar lists years from facet data', () => {
    const group = archiveSidebarGroup([2026, 2025]);
    expect(group.items).toHaveLength(3);
    expect(group.items[1]?.href).toBe('/archive?year=2026');
    expect(group.items[2]?.href).toBe('/archive?year=2025');
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

  it('archive year query', () => {
    expect(isCurrentSidebarItem('/archive', '/archive', '')).toBe(true);
    expect(
      isCurrentSidebarItem('/archive', '/archive?year=2026', 'year=2026'),
    ).toBe(true);
    expect(
      isCurrentSidebarItem('/archive', '/archive?year=2026', 'year=2025'),
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
    // 본문과 같은 함수로 기대값을 만든다. 여기서 기기 연도를 따로 세면
    // 기계 시간대가 KST 가 아닐 때 이 스펙 자체가 갈린다.
    const thisYear = String(currentRankingYear());

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

  /**
   * 기기 시계가 KST 가 아니면 「올해」가 두 값으로 갈린다. 본문은 서울 연도
   * (`currentRankingYear`)를 쓰는데 사이드바가 `new Date().getFullYear()` 로 따로
   * 세면 기기 연도를 쓰기 때문이다. 연말·연초의 그 구간에서는 「전체」도 연도도
   * 강조되지 않아, 지금 어느 연도의 표를 보는지 왼쪽 메뉴로 확인할 수 없다.
   *
   * 개발 기계와 CI 가 KST 라 두 값이 같아서 기본 환경에서는 이 갈림이 드러나지
   * 않는다 — `process.env.TZ` 를 바꿔야 잡힌다
   * (`features/programs/application-presentation.test.ts` 와 같은 이유).
   */
  describe('`year` 부재 강조는 기기 시간대를 타지 않는다', () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      vi.useRealTimers();
      // 원래 미설정이었으면 `= undefined` 가 문자열 "undefined" 를 넣어 기본
      // 시간대가 UTC 로 떨어진다. 지워야 원래대로 돌아온다.
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    function freezeAt(timeZone: string, isoUtc: string): void {
      process.env.TZ = timeZone;
      vi.useFakeTimers();
      vi.setSystemTime(new Date(isoUtc));
    }

    it('UTC 기기에서 1월 1일 00:30 KST 면 서울 연도가 강조된다', () => {
      // 2025-12-31T15:30Z = 서울 2026-01-01 00:30. UTC 기기는 아직 2025 다.
      freezeAt('UTC', '2025-12-31T15:30:00.000Z');
      // 시간대 고정이 실제로 먹었는지 먼저 본다 — 안 먹으면 아래가 조용히 통과한다.
      expect(new Date().getFullYear()).toBe(2025);

      expect(isCurrentSidebarItem('/ranking', '/ranking?year=2026', '')).toBe(
        true,
      );
      expect(isCurrentSidebarItem('/ranking', '/ranking?year=2025', '')).toBe(
        false,
      );
      expect(isCurrentSidebarItem('/ranking', '/ranking?year=all', '')).toBe(
        false,
      );
    });

    it('KST 보다 앞선 기기의 자정 직후에도 서울 연도가 강조된다', () => {
      // 2026-12-31T10:10Z = UTC+14 기기로는 2027-01-01 00:10, 서울은 아직 2026-12-31.
      freezeAt('Pacific/Kiritimati', '2026-12-31T10:10:00.000Z');
      expect(new Date().getFullYear()).toBe(2027);

      expect(isCurrentSidebarItem('/ranking', '/ranking?year=2026', '')).toBe(
        true,
      );
      expect(isCurrentSidebarItem('/ranking', '/ranking?year=2027', '')).toBe(
        false,
      );
    });
  });

  it('archive detail does not highlight filters', () => {
    expect(isCurrentSidebarItem('/archive/123', '/archive', '')).toBe(false);
    expect(isCurrentSidebarItem('/archive/123', '/archive?year=2026', '')).toBe(
      false,
    );
  });

  it('회원 공통 홈 메뉴는 /dashboard에서만 강조된다', () => {
    expect(isCurrentSidebarItem('/dashboard', '/dashboard', '')).toBe(true);
    expect(isCurrentSidebarItem('/staff/dashboard', '/dashboard', '')).toBe(
      false,
    );
    expect(isCurrentSidebarItem('/dashboard/users', '/dashboard', '')).toBe(
      false,
    );
    expect(isCurrentSidebarItem('/dashboard/users/u1', '/dashboard', '')).toBe(
      false,
    );
    expect(
      isCurrentSidebarItem('/dashboard/users', '/dashboard/users', ''),
    ).toBe(true);
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
    expect(SECTION_FACETS.archive?.param).toBe('year');
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

  it('STUDENT view: 단계 탐색을 불러오기 전에는 제출 항목 요약을 레거시 체크리스트 링크로 쓰지 않는다', () => {
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
      href: '/programs/prog-1/documents',
      count: '2/6',
      depth: 0,
    });
    expect(documents?.items).toHaveLength(1);
    expect(documents?.items[0]?.href).not.toContain('milestoneId=');
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
    expect(documents?.items[0]).toMatchObject({
      label: '서류 현황',
      href: '/programs/prog-1/documents',
    });
    expect(documents?.items[0]?.count).toBeUndefined();
    expect(documents?.items[1]).toMatchObject({
      label: '모든 단계',
      href: '/programs/prog-1/documents',
      count: '47팀',
    });
    expect(documents?.items[2]).toMatchObject({
      label: '프로젝트 계획서 제출',
      href: '/programs/prog-1/documents?milestoneId=m3',
      count: '2/47팀',
    });
    expect(documents?.items[3]).toMatchObject({
      label: '1차 중간 산출물 제출',
      href: '/programs/prog-1/documents?milestoneId=m4',
      count: '0/47팀',
    });
    expect(documents?.items.some((i) => i.label === '내 제출물')).toBe(false);
  });

  it('STAFF view: 서류 항목이 없는 단계도 전체 단계 탐색에는 남긴다', () => {
    const groups = programScopeSidebarGroups({
      ...base,
      viewerRole: 'STAFF',
      milestones: [
        {
          milestoneId: 'm1',
          title: '1차 계획서',
          submissionEnabled: true,
        },
        {
          milestoneId: 'm2',
          title: '중간 보고서',
          submissionEnabled: true,
        },
      ],
      milestoneDocuments: [
        {
          milestoneId: 'm1',
          title: '1차 계획서',
          completed: 2,
          total: 3,
        },
      ],
    });

    expect(groups[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '1차 계획서',
          href: '/programs/prog-1/documents?milestoneId=m1',
          count: '2/47팀',
        }),
        expect.objectContaining({
          label: '중간 보고서',
          href: '/programs/prog-1/documents?milestoneId=m2',
          count: undefined,
        }),
      ]),
    );
  });

  it('STUDENT view: 제출을 받지 않는 안내 단계는 내 제출물 탐색에서 뺀다', () => {
    const groups = programScopeSidebarGroups({
      ...base,
      viewerRole: 'STUDENT',
      milestones: [
        {
          milestoneId: 'm1',
          title: '1차 계획서',
          submissionEnabled: true,
        },
        {
          milestoneId: 'notice',
          title: '오리엔테이션',
          submissionEnabled: false,
        },
      ],
      milestoneDocuments: [],
    });

    expect(groups[1]?.items.map((item) => item.label)).toEqual([
      '내 제출물',
      '1차 계획서',
    ]);
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

describe('programScopeSidebarGroups — 참여자 전용 항목 잠금(#1099)', () => {
  const base = {
    programId: 'prog-1',
    teamCount: 47,
    boardPostCount: 3,
  } as const;

  const notParticipant = {
    ...base,
    viewerRole: 'STUDENT',
    viewerParticipant: false,
    viewerDocuments: { completed: 0, total: 2 },
    milestones: [
      { milestoneId: 'm1', title: '1차 계획서', submissionEnabled: true },
    ],
    milestoneDocuments: [
      { milestoneId: 'm1', title: '1차 계획서', completed: 0, total: 1 },
    ],
  } as const;

  it('승인된 신청이 없는 학생에게도 항목은 그대로 남는다 — 숨기지 않는다', () => {
    const groups = programScopeSidebarGroups(notParticipant);

    expect(groups).toHaveLength(3);
    expect(groups[1]?.items[0]?.label).toBe('내 제출물');
    expect(groups[2]?.items[0]?.label).toBe('게시판');
  });

  it('내 제출물·게시판만 잠기고 개요·참여 팀은 그대로 열린다', () => {
    const groups = programScopeSidebarGroups(notParticipant);

    expect(groups[0]?.items.map((item) => item.locked)).toEqual([
      undefined,
      undefined,
    ]);
    expect(groups[1]?.items[0]?.locked).toBe(true);
    expect(groups[2]?.items[0]?.locked).toBe(true);
  });

  it('잠긴 항목에는 카운트를 붙이지 않는다 — 뱃지 자리는 잠금 문구가 쓴다', () => {
    const groups = programScopeSidebarGroups(notParticipant);

    expect(groups[1]?.items[0]?.count).toBeUndefined();
    expect(groups[2]?.items[0]?.count).toBeUndefined();
  });

  it('잠긴 부모 아래 단계 자식을 펴지 않는다', () => {
    const groups = programScopeSidebarGroups(notParticipant);

    expect(groups[1]?.items).toHaveLength(1);
  });

  it('참여자에게는 지금과 똑같이 열린다', () => {
    const groups = programScopeSidebarGroups({
      ...notParticipant,
      viewerParticipant: true,
    });

    expect(groups[1]?.items[0]).toMatchObject({
      label: '내 제출물',
      count: '0/2',
      locked: false,
    });
    expect(groups[1]?.items.map((item) => item.label)).toEqual([
      '내 제출물',
      '1차 계획서',
    ]);
    expect(groups[2]?.items[0]).toMatchObject({ count: '3', locked: false });
  });

  it('참여 여부를 아직 모르면 잠그지 않는다 — 추측으로 affordance를 지우지 않는다', () => {
    const groups = programScopeSidebarGroups({
      ...notParticipant,
      viewerParticipant: undefined,
    });

    expect(groups[1]?.items[0]?.locked).toBe(false);
    expect(groups[2]?.items[0]?.locked).toBe(false);
  });

  it('교직원 좌측 패널 구성은 참여 여부와 무관하게 그대로다', () => {
    const staff = programScopeSidebarGroups({
      ...base,
      viewerRole: 'STAFF',
      milestoneDocuments: [
        { milestoneId: 'm1', title: '1차 계획서', completed: 2, total: 3 },
      ],
    });
    const staffWithFlag = programScopeSidebarGroups({
      ...base,
      viewerRole: 'STAFF',
      viewerParticipant: false,
      milestoneDocuments: [
        { milestoneId: 'm1', title: '1차 계획서', completed: 2, total: 3 },
      ],
    });

    expect(staffWithFlag).toEqual(staff);
    expect(
      staffWithFlag.flatMap((group) => group.items).some((item) => item.locked),
    ).toBe(false);
  });

  it('비회원(GUEST) 좌측 패널 구성은 참여 여부와 무관하게 그대로다', () => {
    const guest = programScopeSidebarGroups({ ...base, viewerRole: 'GUEST' });
    const guestWithFlag = programScopeSidebarGroups({
      ...base,
      viewerRole: 'GUEST',
      viewerParticipant: false,
    });

    expect(guestWithFlag).toEqual(guest);
    expect(guestWithFlag).toHaveLength(1);
  });
});
