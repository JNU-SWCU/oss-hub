import type { AuthSession, Me } from '@/features/auth/types';

type MemberAuthority = Pick<
  Me,
  'memberKind' | 'hasStaffAccess' | 'hasAdminAccess'
>;

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

const SYNTHETIC_IDENTITY = {
  nickname: 'synthetic-session',
  name: '합성 사용자',
  email: null,
  avatarUrl: null,
  isProfileComplete: true,
} as const satisfies Omit<Me, keyof MemberAuthority>;

export function authenticatedSessionBody(actor: SessionActor): AuthSession {
  return {
    isAuthenticated: true,
    user: { ...SYNTHETIC_IDENTITY, ...SESSION_AUTHORITIES[actor] },
  };
}
