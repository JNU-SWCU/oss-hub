import type { AdminUser, UserRole } from './types';

export function requiresRoleChangeConfirmation(
  user: AdminUser,
  nextRole: UserRole,
): boolean {
  return (
    ((user.role === 'STAFF' || user.role === 'ADMIN') &&
      nextRole === 'STUDENT') ||
    (user.isSelf && user.role === 'ADMIN' && nextRole !== 'ADMIN')
  );
}

export function roleChangeDestination(
  user: AdminUser,
  nextRole: UserRole,
): string | null {
  if (!user.isSelf || nextRole === 'ADMIN') return null;
  return nextRole === 'STUDENT' ? '/dashboard' : '/staff/dashboard';
}
