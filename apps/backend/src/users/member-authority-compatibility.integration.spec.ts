import { requestHistory } from './user-history.integration-fixture';

import {
  AffiliationKind,
  MemberKind,
  StaffAccessRequestStatus,
} from './user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
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
import { ADMIN_ACCESS_REQUEST_DECISIONS } from './admin-access-query.config';
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
it('student completion writes canonical profile and authority defaults atomically', async () => {
  const user = await createOnboardingUser('student', MemberKind.STUDENT);
  await users.completeMyProfile(user.githubId, {
    name: '  합성 학생  ',
    studentId: '801001',
    phone: '80000801001',
    department: '  인공지능학부  ',
  });
  await expect(storedMember(user.id)).resolves.toMatchObject({
    name: '합성 학생',
    type: MemberKind.STUDENT,
    departmentType: AffiliationKind.DEPARTMENT,
    studentId: '801001',
    department: '인공지능학부',
    approvalStatus: 'NOT_REQUIRED',
    admin: null,
  });
});
it('staff completion writes program-office affiliation, null student ID, defaults, and one pending request atomically', async () => {
  const user = await createOnboardingUser('staff', MemberKind.STAFF);
  await users.completeMyProfile(user.githubId, {
    name: '  합성 교직원  ',
    affiliationKind: AffiliationKind.PROGRAM_OFFICE,
    affiliationName: '  합성 사업단  ',
  });
  const [stored, requests] = await Promise.all([
    storedMember(user.id),
    requestHistory(prisma, user.id),
  ]);
  expect(stored).toMatchObject({
    name: '합성 교직원',
    type: MemberKind.STAFF,
    departmentType: AffiliationKind.PROGRAM_OFFICE,
    studentId: null,
    department: '합성 사업단',
    approvalStatus: 'PENDING',
    admin: null,
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.status).toBe(StaffAccessRequestStatus.PENDING);
});
it('approval grants staff access without changing staff member kind or admin access', async () => {
  const actor = await createAdmin('approval-actor');
  const target = await completeStaff('approval-target');
  const request = await pendingRequest(target.id);
  await access.patchAccess(actor.githubId, target.id, {
    ...ACTIVE_ACCESS_STATE,
    expectedRole: null,
    desiredRole: 'STAFF',
    expectedPendingRequest: {
      id: request.id,
      status: StaffAccessRequestStatus.PENDING,
    },
    requestDecision: { decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE },
  });
  await expect(storedMember(target.id)).resolves.toMatchObject({
    type: MemberKind.STAFF,
    approvalStatus: 'APPROVED',
    admin: null,
  });
});
it('rejection keeps staff access disabled without erasing staff member kind', async () => {
  const actor = await createAdmin('rejection-actor');
  const target = await completeStaff('rejection-target');
  const request = await pendingRequest(target.id);
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
  await expect(storedMember(target.id)).resolves.toMatchObject({
    type: MemberKind.STAFF,
    approvalStatus: 'REJECTED',
    admin: null,
  });
});
it('revocation removes staff access without erasing staff member kind or granting admin access', async () => {
  const actor = await createAdmin('revocation-actor');
  const target = await completeStaff('revocation-target');
  const request = await pendingRequest(target.id);
  await access.patchAccess(actor.githubId, target.id, {
    ...ACTIVE_ACCESS_STATE,
    expectedRole: null,
    desiredRole: 'STAFF',
    expectedPendingRequest: {
      id: request.id,
      status: StaffAccessRequestStatus.PENDING,
    },
    requestDecision: { decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE },
  });
  await access.patchAccess(actor.githubId, target.id, {
    ...ACTIVE_ACCESS_STATE,
    expectedRole: 'STAFF',
    desiredRole: null,
    expectedPendingRequest: null,
  });
  await expect(storedMember(target.id)).resolves.toMatchObject({
    type: MemberKind.STAFF,
    approvalStatus: 'REVOKED',
    admin: null,
  });
  await expect(
    requestHistory(prisma, target.id)
      .then((rows) =>
        rows.filter((row) => row.status === StaffAccessRequestStatus.REVOKED),
      )
      .then((rows) => rows.length),
  ).resolves.toBe(1);
});
it('admin grant stays independent from student membership and staff access', async () => {
  const actor = await createAdmin('admin-grant-actor');
  const target = await createOnboardingUser(
    'student-admin-target',
    MemberKind.STUDENT,
  );
  await users.completeMyProfile(target.githubId, {
    name: '합성 학생 관리자',
    studentId: '801010',
    phone: '80000801010',
    department: '인공지능학부',
  });
  await access.patchAccess(actor.githubId, target.id, {
    ...ACTIVE_ACCESS_STATE,
    expectedRole: 'STUDENT',
    desiredRole: 'ADMIN',
    expectedPendingRequest: null,
  });
  await expect(storedMember(target.id)).resolves.toMatchObject({
    type: MemberKind.STUDENT,
    approvalStatus: 'NOT_REQUIRED',
    admin: { userId: target.id },
  });
});
it('concurrent completion allows exactly one atomic winner', async () => {
  const target = await createOnboardingUser(
    'concurrent-target',
    MemberKind.STUDENT,
  );
  const complete = () =>
    users.completeMyProfile(target.githubId, {
      name: '합성 동시 학생',
      studentId: '801011',
      phone: '80000801011',
      department: '인공지능학부',
    });
  const results = await Promise.allSettled([complete(), complete()]);
  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
    1,
  );
  expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  await expect(storedMember(target.id)).resolves.toMatchObject({
    type: MemberKind.STUDENT,
    studentId: '801011',
    name: '합성 동시 학생',
  });
});
it('duplicate student ID completion fails closed without partial writes', async () => {
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
    phone: '80000801012',
    department: '인공지능학부',
  });
  const completion = users.completeMyProfile(second.githubId, {
    name: '합성 둘째 학생',
    studentId: '801012',
    phone: '80000801013',
    department: '인공지능학부',
  });
  await expect(completion).rejects.toMatchObject({
    errorCode: { code: 'USR_004', status: 409 },
  });
  await expect(storedMember(second.id)).resolves.toMatchObject({
    profileCreatedAt: null,
    approvalStatus: 'NOT_REQUIRED',
    admin: null,
  });
});
