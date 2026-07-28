import { Role, RoleRequestStatus } from '@prisma/client';

export function resolveRoleRequestTransition(
  currentStatus: RoleRequestStatus | null,
  role: Role,
): RoleRequestStatus | null {
  if (currentStatus === RoleRequestStatus.PENDING) {
    return role === Role.STAFF
      ? RoleRequestStatus.APPROVED
      : RoleRequestStatus.REJECTED;
  }
  if (currentStatus === RoleRequestStatus.APPROVED && role !== Role.STAFF) {
    return RoleRequestStatus.REVOKED;
  }
  return null;
}
