import type {
  ProgramScopeSidebarGroup,
  ProgramScopeViewerRole,
} from './sidebar-menu';

export function withoutLoadingCounts(
  groups: readonly ProgramScopeSidebarGroup[],
): readonly ProgramScopeSidebarGroup[] {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.count === undefined ? item : { ...item, count: undefined },
    ),
  }));
}

export function shouldLoadProgramOverview(
  programDetailId: string | null,
  member: boolean,
): programDetailId is string {
  return programDetailId !== null && member;
}

/**
 * 「내 신청」 조회 발화 조건 — 개요와 같은 조건에 **학생 뷰어**를 하나 더 건다(#1099).
 *
 * 교직원 면으로 그려지는 뷰어(`hasStaffAccess`)는 참여 여부와 무관하게 두 화면이 열리므로
 * 물을 이유가 없고, 물으면 `programs/:id/applications/me`가 `APP_008`(학생 전용)로 답해
 * 로그만 더럽힌다.
 *
 * **관리자 권한만 가진 학생 회원은 여전히 학생 뷰어라 묻는다.** 그 계정의 학생 자격 판정은
 * 회원 유형만 보므로(`profiles/user-profile-read.ts`의 `STUDENT_MEMBER_WHERE`) 이 조회는
 * `APP_008`이 아니라 신청 유무로 답하고, 그 답이 「내 제출물」을 그릴지 정한다. 게시판은
 * 그 답을 쓰지 않는다 — 관리자 권한이 따로 연다(`programScopeSidebarGroups`).
 */
export function shouldLoadProgramParticipation(
  programDetailId: string | null,
  member: boolean,
  studentViewer: boolean,
): programDetailId is string {
  return shouldLoadProgramOverview(programDetailId, member) && studentViewer;
}

export function programScopeViewerRole(
  member: boolean,
  authority: {
    readonly memberKind: 'STUDENT' | 'STAFF' | null;
    readonly hasStaffAccess: boolean;
  },
): ProgramScopeViewerRole {
  if (!member) return 'GUEST';
  if (authority.hasStaffAccess) return 'STAFF';
  return authority.memberKind === 'STUDENT' ? 'STUDENT' : 'GUEST';
}
