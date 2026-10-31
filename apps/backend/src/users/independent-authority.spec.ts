import { MemberKind } from '@prisma/client';
import { AUTHORITY_TARGETS } from './admin-access-query.config';
import { IndependentAuthorityService } from './independent-authority.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserProfileService } from './user-profile.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';

const independentAuthorityService = new IndependentAuthorityService(
  undefined as never,
  undefined as never,
  new AuditLogMetadataService(),
  new AdminAccessMutationService(
    new AuditLogMetadataService(),
    new UserProfileService(),
  ),
  new UserProfileService(),
);

describe('independent-authority-transition', () => {
  const student = {
    memberKind: MemberKind.STUDENT,
    selectedMemberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
  } as const;

  it('grants admin to a student without granting staff', () => {
    expect(
      independentAuthorityService.resolveIndependentAuthorityTransition(
        student,
        AUTHORITY_TARGETS.ADMIN,
        true,
      ),
    ).toEqual({
      ...student,
      role: 'ADMIN',
      hasAdminAccess: true,
    });
  });

  it('grants staff without granting admin', () => {
    expect(
      independentAuthorityService.resolveIndependentAuthorityTransition(
        student,
        AUTHORITY_TARGETS.STAFF,
        true,
      ),
    ).toEqual({
      ...student,
      role: 'STAFF',
      hasStaffAccess: true,
    });
  });

  it('revokes staff from staff-admin while preserving admin', () => {
    expect(
      independentAuthorityService.resolveIndependentAuthorityTransition(
        { ...student, hasStaffAccess: true, hasAdminAccess: true },
        AUTHORITY_TARGETS.STAFF,
        false,
      ),
    ).toMatchObject({
      memberKind: MemberKind.STUDENT,
      role: 'ADMIN',
      hasStaffAccess: false,
      hasAdminAccess: true,
    });
  });

  it('revokes admin from staff-admin while preserving staff', () => {
    expect(
      independentAuthorityService.resolveIndependentAuthorityTransition(
        { ...student, hasStaffAccess: true, hasAdminAccess: true },
        AUTHORITY_TARGETS.ADMIN,
        false,
      ),
    ).toMatchObject({
      memberKind: MemberKind.STUDENT,
      role: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: false,
    });
  });

  it('supports admin-only compatibility without inventing membership', () => {
    expect(
      independentAuthorityService.resolveIndependentAuthorityTransition(
        {
          memberKind: null,
          selectedMemberKind: null,
          hasStaffAccess: false,
          hasAdminAccess: false,
        },
        AUTHORITY_TARGETS.ADMIN,
        true,
      ),
    ).toEqual({
      memberKind: null,
      selectedMemberKind: null,
      role: 'ADMIN',
      hasStaffAccess: false,
      hasAdminAccess: true,
    });
  });
});
