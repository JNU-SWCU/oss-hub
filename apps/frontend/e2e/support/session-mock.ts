import type { AuthSession, Me } from '@/features/auth/types';

/**
 * `/api/v1/auth/session` 목의 단 하나의 출처.
 *
 * member-authority 이관으로 세션 응답에서 `role`이 사라지고 권한 필드로 갈렸는데,
 * 스펙마다 손으로 적어 둔 목은 옛 모양 그대로 남았다. 화면은 그 목을 권한이 하나도
 * 없는 사용자로 읽어 편집 화면 요청을 온보딩·랜딩으로 되돌렸고, 실패는 "제목을 못
 * 찾음"으로만 보여 원인을 가렸다(#1086). 목이 `Me`를 참조하면 다음 계약 변경은
 * 브라우저 실행이 아니라 typecheck가 먼저 잡는다.
 */

type MemberAuthority = Pick<
  Me,
  'memberKind' | 'hasStaffAccess' | 'hasAdminAccess'
>;

/**
 * 스펙이 고르는 사람 — 접근 판정은 권한 필드로만 이뤄진다(`_shell/member-access.ts`).
 *
 * 관리자도 `hasStaffAccess`를 함께 든다. 프로그램 편집은 staff 면을 요구하므로
 * (`programs/[id]/edit/page.tsx`의 `allow={['staff']}`) 관리자 권한만 가진 계정은
 * 그 화면에 애초에 닿지 못한다 — 「위험 영역」을 보는 사람은 둘 다 가진 사람이다.
 */
const SESSION_AUTHORITIES = {
  admin: {
    memberKind: 'STAFF',
    hasStaffAccess: true,
    hasAdminAccess: true,
  },
  staff: {
    memberKind: 'STAFF',
    hasStaffAccess: true,
    hasAdminAccess: false,
  },
} as const satisfies Record<string, MemberAuthority>;

export type SessionActor = keyof typeof SESSION_AUTHORITIES;

/** 권한과 무관한 신원 — 어느 사람으로 들어와도 화면에 뜨는 값은 같다. */
const SYNTHETIC_IDENTITY = {
  nickname: 'synthetic-session',
  name: '합성 사용자',
  email: null,
  avatarUrl: null,
  isProfileComplete: true,
} as const satisfies Omit<Me, keyof MemberAuthority>;

/** `/auth/session`이 인증된 사용자에게 내려주는 본문. */
export function authenticatedSessionBody(actor: SessionActor): AuthSession {
  return {
    isAuthenticated: true,
    user: { ...SYNTHETIC_IDENTITY, ...SESSION_AUTHORITIES[actor] },
  };
}
