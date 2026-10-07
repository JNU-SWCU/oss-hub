'use client';

import { usePathname } from 'next/navigation';
import { StatusBadge } from '@/components/status-badge';
import { LoginButton } from '@/features/auth/components/login-button';
import { TeamInvitationNotifications } from '@/features/programs/team-invitation-notifications';
import { useSession } from '@/features/auth/use-session';
import { memberSurfaces, type MemberSurface } from './member-access';
import { shouldShowAccountSlot } from './signup-completion';
import { useSessionRole } from './use-session-role';

const SURFACE_CHIP_LABEL: Record<MemberSurface, string> = {
  student: '학생',
  staff: '교직원',
  admin: '관리자',
};

const SURFACE_CHIP_VARIANT: Record<MemberSurface, 'recruiting' | 'approved'> = {
  student: 'recruiting',
  staff: 'approved',
  admin: 'approved',
};

export function AccountSlot() {
  const state = useSessionRole();
  const session = useSession();
  const pathname = usePathname();

  if (!shouldShowAccountSlot(state, pathname)) {
    return null;
  }

  const surfaces =
    state.status === 'assigned' && state.isProfileComplete
      ? memberSurfaces(state)
      : [];
  const showTeamInvitations = surfaces.includes('student');
  const identityKey = session.user?.nickname ?? null;
  const accountRoles =
    surfaces.length > 1
      ? surfaces.map((surface) => SURFACE_CHIP_LABEL[surface]).join(' · ')
      : undefined;

  return (
    <div className="flex items-center gap-2">
      {showTeamInvitations ? (
        <TeamInvitationNotifications identityKey={identityKey} />
      ) : null}
      {accountRoles ? (
        <StatusBadge
          variant="approved"
          className="min-[900px]:hidden"
          aria-label={`${accountRoles} 권한`}
        >
          권한 {surfaces.length}개
        </StatusBadge>
      ) : null}
      {surfaces.map((surface) => (
        <StatusBadge
          key={surface}
          variant={SURFACE_CHIP_VARIANT[surface]}
          className={
            accountRoles ? 'hidden min-[900px]:inline-flex' : undefined
          }
          aria-label={`${SURFACE_CHIP_LABEL[surface]} 권한`}
        >
          {SURFACE_CHIP_LABEL[surface]}
        </StatusBadge>
      ))}
      <LoginButton accountRoles={accountRoles} />
    </div>
  );
}
