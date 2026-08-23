import type { NavItem } from '@/components';

/**
 * 역할별 좌측 패널 메뉴 — 상단 waypoint + 섹션 사이드 패널 전용.
 * 화면 안 PageHeader actions로 같은 목적지를 다시 두지 않는다.
 * id 문맥 경로(신청·제출·검토)는 상세 흐름에서만 진입한다.
 */
export const STUDENT_MENU: NavItem[] = [
  { label: '내 대시보드', href: '/dashboard' },
  { label: '내 저장소', href: '/my-repos' },
  { label: '내 활동', href: '/dashboard/activity' },
];

export const STAFF_MENU: NavItem[] = [
  // 입구 URL은 회원 공통 `/dashboard`. 본문만 세션 역할(STAFF)로 갈린다.
  { label: '운영 대시보드', href: '/dashboard' },
  { label: '학생 활성', href: '/dashboard/insights' },
  { label: '가입 신청', href: '/dashboard/applicants' },
];

/**
 * 관리자 그룹 — 시스템 도구는 `/admin/*`만 쓴다.
 *
 * 교직원 메뉴는 여기 섞지 않는다. 관리자 권한(`hasAdminAccess`)과 교직원 권한
 * (`hasStaffAccess`)은 서로 독립이라 각자 자기 그룹만 책임진다 — 예전에는 legacy
 * `ADMIN` 역할 하나가 두 메뉴를 다 끌고 와야 해서 `STAFF_MENU`를 복제한 별도
 * 상수를 뒀지만, 사이드바가 canonical 권한으로 합집합을 만드는 지금은 그 복제가
 * 갈라질 자리만 남긴다.
 */
export const ADMIN_SYSTEM_MENU: NavItem[] = [
  { label: '사용자 목록', href: '/admin/access' },
  { label: '감사 로그', href: '/admin/audit-log' },
  { label: '시스템 상태', href: '/admin/system-status' },
];

/**
 * ADMIN 메뉴 평탄 목록. 첫 항목이 역할 홈(`/dashboard`)이다.
 * 사이드 그룹 조립은 `STAFF_MENU` / `ADMIN_SYSTEM_MENU`를 권한별로 쓴다.
 */
export const ADMIN_MENU: NavItem[] = [...STAFF_MENU, ...ADMIN_SYSTEM_MENU];
