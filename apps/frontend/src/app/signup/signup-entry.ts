import { ROLE_HOME_LABEL } from '../_shell/role-home-link';
import { roleHomePath } from '../_shell/role';
import { memberSurfaces, type MemberAccess } from '../_shell/member-access';
import type { SessionStatus } from '../_shell/use-session-role';

export const ONBOARDING_ENTRY_PATH = '/consent';

export const GITHUB_SIGNUP_URL = 'https://github.com/signup';

export type SignupEntryDecision =
  | { readonly kind: 'invite' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'resume'; readonly href: string; readonly label: string };

export function signupEntryDecision(
  status: SessionStatus,
  access: MemberAccess,
  isProfileComplete = true,
): SignupEntryDecision {
  switch (status) {
    case 'loading':
      return { kind: 'checking' };
    case 'anonymous':
    case 'error':
      return { kind: 'invite' };
    case 'unassigned':
      return {
        kind: 'resume',
        href: ONBOARDING_ENTRY_PATH,
        label: '이어서 진행하기',
      };
    case 'assigned': {
      const label = homeLabelFor(access);
      if (label === null) {
        return { kind: 'invite' };
      }

      return isProfileComplete
        ? {
            kind: 'resume',
            href: roleHomePath(),
            label: ROLE_HOME_LABEL[label],
          }
        : {
            kind: 'resume',
            href: ONBOARDING_ENTRY_PATH,
            label: '이어서 진행하기',
          };
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function homeLabelFor(
  access: MemberAccess,
): 'STUDENT' | 'STAFF' | 'ADMIN' | null {
  const surfaces = memberSurfaces(access);
  if (surfaces.includes('admin')) return 'ADMIN';
  if (surfaces.includes('staff')) return 'STAFF';
  return surfaces.includes('student') ? 'STUDENT' : null;
}
