import { MemberKind } from '@prisma/client';
import {
  AUTHORITY_TARGETS,
  resolveIndependentAuthorityTransition,
} from './independent-authority-transition';

const student = {
  memberKind: MemberKind.STUDENT,
  selectedRole: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
} as const;

it('grants admin to a student without granting staff', () => {
  expect(
    resolveIndependentAuthorityTransition(
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
    resolveIndependentAuthorityTransition(
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
    resolveIndependentAuthorityTransition(
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
    resolveIndependentAuthorityTransition(
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
    resolveIndependentAuthorityTransition(
      {
        memberKind: null,
        selectedRole: null,
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
      AUTHORITY_TARGETS.ADMIN,
      true,
    ),
  ).toEqual({
    memberKind: null,
    selectedRole: null,
    role: 'ADMIN',
    hasStaffAccess: false,
    hasAdminAccess: true,
  });
});
