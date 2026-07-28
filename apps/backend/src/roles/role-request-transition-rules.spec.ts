import { Role, RoleRequestStatus } from '@prisma/client';
import { resolveRoleRequestTransition } from './role-request-transition-rules';

describe('resolveRoleRequestTransition', () => {
  it.each([
    [RoleRequestStatus.PENDING, Role.STAFF, RoleRequestStatus.APPROVED],
    [RoleRequestStatus.PENDING, Role.STUDENT, RoleRequestStatus.REJECTED],
    [RoleRequestStatus.PENDING, Role.ADMIN, RoleRequestStatus.REJECTED],
    [RoleRequestStatus.APPROVED, Role.STAFF, null],
    [RoleRequestStatus.APPROVED, Role.STUDENT, RoleRequestStatus.REVOKED],
    [RoleRequestStatus.APPROVED, Role.ADMIN, RoleRequestStatus.REVOKED],
    [null, Role.STAFF, null],
    [RoleRequestStatus.REJECTED, Role.STAFF, null],
    [RoleRequestStatus.REVOKED, Role.STAFF, null],
  ])(
    '현재 상태 %s에서 역할 %s를 부여하면 %s를 반환한다',
    (status, role, expected) => {
      expect(resolveRoleRequestTransition(status, role)).toBe(expected);
    },
  );
});
