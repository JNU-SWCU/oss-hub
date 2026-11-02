import { UserProfileService } from './user-profile.service';
const service = new UserProfileService();
const fields = {
  name: 'Name',
  studentId: null,
  department: 'Department',
  profileCreatedAt: new Date('2026-01-01'),
};
it.each([
  ['STUDENT', true],
  ['STAFF', false],
] as const)('%s requires studentId=%s', (memberKind, studentId) => {
  expect(service.profileFieldRequirement(memberKind)).toEqual({
    studentId,
    department: true,
  });
});
it.each([
  ['STUDENT', false],
  ['STAFF', true],
] as const)(
  'checks %s completion without studentId',
  (memberKind, expected) => {
    expect(
      service.isCompleteUserProfile({
        ...fields,
        memberKind,
        selectedMemberKind: memberKind,
      }),
    ).toBe(expected);
  },
);
it.each(['STUDENT', 'STAFF'] as const)(
  'requires department for %s',
  (memberKind) => {
    expect(
      service.isCompleteUserProfile({
        ...fields,
        department: null,
        studentId: '123456',
        memberKind,
        selectedMemberKind: memberKind,
      }),
    ).toBe(false);
  },
);
it('validates retained optional studentId and Unicode profile names', () => {
  expect(
    service.isCompleteUserProfile({
      ...fields,
      studentId: '12A456',
      memberKind: 'STAFF',
      selectedMemberKind: 'STAFF',
    }),
  ).toBe(false);
  expect(
    service.isCompleteUserProfile({
      ...fields,
      name: null,
      memberKind: 'STAFF',
      selectedMemberKind: 'STAFF',
    }),
  ).toBe(false);
});
it('does not infer STAFF from an old pending-request compatibility flag', () => {
  expect(
    service.effectiveProfileMemberKind({
      memberKind: null,
      selectedMemberKind: null,
      hasPendingStaffRequest: true,
    }),
  ).toBeNull();
  expect(
    service.isCompleteUserProfile({
      ...fields,
      memberKind: null,
      selectedMemberKind: null,
    }),
  ).toBe(false);
});
it('keeps approved, rejected and revoked STAFF profile completion independent of access', () => {
  expect(
    service.isCompleteUserProfile({
      ...fields,
      memberKind: 'STAFF',
      selectedMemberKind: 'STAFF',
    }),
  ).toBe(true);
  expect(
    service.isCompleteUserProfile({
      ...fields,
      profileCreatedAt: null,
      memberKind: 'STAFF',
      selectedMemberKind: 'STAFF',
    }),
  ).toBe(false);
});
it('keeps strict new studentId validation separate from stored legacy studentId validity', () => {
  expect(
    service.isValidCompleteUserProfileFields({
      name: 'Name',
      studentId: '123456',
      department: 'Department',
    }),
  ).toBe(true);
  expect(
    service.isValidCompleteUserProfileFields({
      name: 'Name',
      studentId: '123456789',
      department: 'Department',
    }),
  ).toBe(false);
  expect(service.isStoredStudentId('123456789')).toBe(true);
});
it.each([
  ['STUDENT', 'NOT_REQUIRED', false],
  ['STAFF', 'PENDING', false],
  ['STAFF', 'APPROVED', true],
  ['STAFF', 'REJECTED', false],
  ['STAFF', 'REVOKED', false],
] as const)(
  'projects %s %s staff access as %s',
  (memberKind, approvalStatus, expected) => {
    expect(
      service.hasStaffAccess({ ...fields, memberKind, approvalStatus }),
    ).toBe(expected);
  },
);
it('does not grant staff access to an approved but unfinished profile', () => {
  expect(
    service.hasStaffAccess({
      ...fields,
      profileCreatedAt: null,
      memberKind: 'STAFF',
      approvalStatus: 'APPROVED',
    }),
  ).toBe(false);
});
it.each([
  ['STUDENT', false, true, 'ACTIVE', false],
  ['STAFF', false, true, 'ACTIVE', false],
  ['STAFF', true, true, 'ACTIVE', true],
  ['STAFF', true, false, 'ACTIVE', false],
  ['STAFF', true, true, 'DEACTIVATED', false],
] as const)(
  'operational eligibility enforces type, approval, completion and account status',
  (memberKind, hasStaffAccess, isProfileComplete, accountStatus, expected) => {
    expect(
      service.isStaffEligible({
        memberKind,
        hasStaffAccess,
        isProfileComplete,
        accountStatus,
      }),
    ).toBe(expected);
  },
);
