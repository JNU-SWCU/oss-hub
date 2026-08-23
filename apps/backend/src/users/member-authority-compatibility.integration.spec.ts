import {
  AffiliationKind,
  MemberKind,
  Role,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { ADMIN_ACCESS_REQUEST_DECISIONS } from './domain/admin-access';
import {
  compatibilityAccess as access,
  compatibilityPrisma as prisma,
  compatibilityUsers as users,
  ACTIVE_ACCESS_STATE,
  completeStaff,
  createAdmin,
  createOnboardingUser,
  pendingRequest,
  storedMember,
} from './member-authority-compatibility.integration-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

it('student completion writes canonical profile, authority defaults, and rollback mirrors atomically', async () => {
  // Given
  const user = await createOnboardingUser('student', MemberKind.STUDENT);

  // When
  await users.completeMyProfile(user.githubId, {
    name: '  합성 학생  ',
    studentId: '801001',
    department: '  인공지능학부  ',
  });

  // Then
  await expect(storedMember(user.id)).resolves.toMatchObject({
    role: Role.STUDENT,
    selectedRole: Role.STUDENT,
    selectedMemberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
    name: '합성 학생',
    studentId: '801001',
    department: '인공지능학부',
    profile: {
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
      studentId: '801001',
    },
  });
});

it('staff completion writes program-office affiliation, null student ID, defaults, and one pending request atomically', async () => {
  // Given
  const user = await createOnboardingUser('staff', MemberKind.STAFF);

  // When
  await users.completeMyProfile(user.githubId, {
    name: '  합성 교직원  ',
    affiliationKind: AffiliationKind.PROGRAM_OFFICE,
    affiliationName: '  합성 사업단  ',
  });

  // Then
  const [stored, requests] = await Promise.all([
    storedMember(user.id),
    prisma.staffAccessRequest.findMany({ where: { userId: user.id } }),
  ]);
  expect(stored).toMatchObject({
    role: null,
    selectedRole: Role.STAFF,
    selectedMemberKind: MemberKind.STAFF,
    hasStaffAccess: false,
    hasAdminAccess: false,
    studentId: null,
    department: '합성 사업단',
    profile: {
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '합성 사업단',
      studentId: null,
    },
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.status).toBe(StaffAccessRequestStatus.PENDING);
});

it('approval grants staff access without changing staff member kind or admin access', async () => {
  // Given
  const actor = await createAdmin('approval-actor');
  const target = await completeStaff('approval-target');
  const request = await pendingRequest(target.id);

  // When
  await access.patchAccess(actor.githubId, target.id, {
    ...ACTIVE_ACCESS_STATE,
    expectedRole: null,
    desiredRole: Role.STAFF,
    expectedPendingRequest: {
      id: request.id,
      status: StaffAccessRequestStatus.PENDING,
    },
    requestDecision: { decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE },
  });

  // Then
  await expect(storedMember(target.id)).resolves.toMatchObject({
    role: Role.STAFF,
    hasStaffAccess: true,
    hasAdminAccess: false,
    profile: { memberKind: MemberKind.STAFF },
  });
});

it('rejection keeps staff access disabled without erasing staff member kind', async () => {
  // Given
  const actor = await createAdmin('rejection-actor');
  const target = await completeStaff('rejection-target');
  const request = await pendingRequest(target.id);

  // When
  await access.patchAccess(actor.githubId, target.id, {
    ...ACTIVE_ACCESS_STATE,
    expectedRole: null,
    desiredRole: null,
    expectedPendingRequest: {
      id: request.id,
      status: StaffAccessRequestStatus.PENDING,
    },
    requestDecision: {
      decision: ADMIN_ACCESS_REQUEST_DECISIONS.REJECT,
      reason: '합성 반려 사유',
    },
  });

  // Then
  await expect(storedMember(target.id)).resolves.toMatchObject({
    role: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    profile: { memberKind: MemberKind.STAFF },
  });
});

it('revocation removes staff access without erasing staff member kind or granting admin access', async () => {
  // Given
  const actor = await createAdmin('revocation-actor');
  const target = await completeStaff('revocation-target');
  const request = await pendingRequest(target.id);
  await access.patchAccess(actor.githubId, target.id, {
    ...ACTIVE_ACCESS_STATE,
    expectedRole: null,
    desiredRole: Role.STAFF,
    expectedPendingRequest: {
      id: request.id,
      status: StaffAccessRequestStatus.PENDING,
    },
    requestDecision: { decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE },
  });

  // When
  await access.patchAccess(actor.githubId, target.id, {
    ...ACTIVE_ACCESS_STATE,
    expectedRole: Role.STAFF,
    desiredRole: null,
    expectedPendingRequest: null,
  });

  // Then
  await expect(storedMember(target.id)).resolves.toMatchObject({
    role: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    profile: { memberKind: MemberKind.STAFF },
  });
  await expect(
    prisma.staffAccessRequest.count({
      where: { userId: target.id, status: StaffAccessRequestStatus.REVOKED },
    }),
  ).resolves.toBe(1);
});

it('admin grant stays independent from student membership and staff access', async () => {
  // Given
  const actor = await createAdmin('admin-grant-actor');
  const target = await createOnboardingUser(
    'student-admin-target',
    MemberKind.STUDENT,
  );
  await users.completeMyProfile(target.githubId, {
    name: '합성 학생 관리자',
    studentId: '801010',
    department: '인공지능학부',
  });

  // When
  await access.patchAccess(actor.githubId, target.id, {
    ...ACTIVE_ACCESS_STATE,
    expectedRole: Role.STUDENT,
    desiredRole: Role.ADMIN,
    expectedPendingRequest: null,
  });

  // Then
  await expect(storedMember(target.id)).resolves.toMatchObject({
    role: Role.ADMIN,
    hasStaffAccess: false,
    hasAdminAccess: true,
    profile: { memberKind: MemberKind.STUDENT },
  });
});

it('concurrent completion allows exactly one atomic winner', async () => {
  // Given
  const target = await createOnboardingUser(
    'concurrent-target',
    MemberKind.STUDENT,
  );
  const complete = () =>
    users.completeMyProfile(target.githubId, {
      name: '합성 동시 학생',
      studentId: '801011',
      department: '인공지능학부',
    });

  // When
  const results = await Promise.allSettled([complete(), complete()]);

  // Then
  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
    1,
  );
  expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  await expect(storedMember(target.id)).resolves.toMatchObject({
    role: Role.STUDENT,
    profile: { memberKind: MemberKind.STUDENT, studentId: '801011' },
  });
});

it('duplicate student ID completion fails closed without partial writes', async () => {
  // Given
  const first = await createOnboardingUser(
    'duplicate-first',
    MemberKind.STUDENT,
  );
  const second = await createOnboardingUser(
    'duplicate-second',
    MemberKind.STUDENT,
  );
  await users.completeMyProfile(first.githubId, {
    name: '합성 첫 학생',
    studentId: '801012',
    department: '인공지능학부',
  });

  // When
  const completion = users.completeMyProfile(second.githubId, {
    name: '합성 둘째 학생',
    studentId: '801012',
    department: '인공지능학부',
  });

  // Then
  await expect(completion).rejects.toMatchObject({
    errorCode: { code: 'USR_004', status: 409 },
  });
  await expect(storedMember(second.id)).resolves.toMatchObject({
    role: null,
    profile: null,
  });
});
