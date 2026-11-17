import {
  DepartmentType,
  MemberKind,
  StaffAccessRequestStatus,
} from './user-contract.config';

import { AdminAccessReadOrderingRepository } from './admin-access-read-ordering.repository';
import { authorityFactsFor } from './canonical-user-fixture';
import { AccountStatus } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { PrismaService } from '../platform/prisma.service';
import {
  type AdminAccessActor,
  AdminAccessReadRepository,
} from './admin-access-read.repository';
import { UsersErrorCode } from './users-error-code.error';
import {
  ADMIN_ACCESS_DECISION_KINDS,
  ADMIN_ACCESS_PENDING_STATES,
  type AdminAccessMutationCommand,
  AdminAccessMutationService,
} from './admin-access-mutation.service';
import { ADMIN_ACCESS_REQUEST_DECISIONS } from './admin-access-query.config';
import { HistoryMetadataService } from '../platform/history-metadata.service';
import { UserProfileService } from './user-profile.service';
import type { AdminAccessUserDetailRow } from './admin-access-read.repository';
import type { AdminAccessUserDetailSource } from './admin-access-read.repository';
const toDetail = (row: AdminAccessUserDetailRow | null) =>
  row &&
  new AdminAccessMutationService(
    new HistoryMetadataService(),
    new UserProfileService(),
  ).toAdminAccessUserDetailRecord(row);
const toRecord = (
  user: Parameters<AdminAccessReadRepository['toAdminAccessUserRow']>[0],
) =>
  new AdminAccessMutationService(
    new HistoryMetadataService(),
    new UserProfileService(),
  ).toAdminAccessUserRecord(
    new AdminAccessReadRepository(
      new AdminAccessReadOrderingRepository(),
    ).toAdminAccessUserRow(user),
  );
const adminAccessMutationService = new AdminAccessMutationService(
  new HistoryMetadataService(),
  new UserProfileService(),
);
describe('admin access read profile completeness', () => {
  it('treats a pending staff request without a student id as complete', async () => {
    const prisma = prismaReturning(
      userRow({
        id: 'pending-staff',
        role: null,
        name: '가나다 교직원',
        studentId: null,
        department: '소프트웨어공학과',
        pendingRequest: pendingRequest(),
      }),
    );
    const detail = toDetail(
      await new AdminAccessReadRepository(
        new AdminAccessReadOrderingRepository(),
      ).findAdminAccessUserById(prisma, 'pending-staff'),
    );
    expect(detail).toMatchObject({
      id: 'pending-staff',
      role: null,
      isProfileComplete: true,
      profile: {
        name: '가나다 교직원',
        studentId: null,
        department: '소프트웨어공학과',
        isComplete: true,
      },
    });
  });
  it('keeps a student without a student id incomplete', async () => {
    const prisma = prismaReturning(
      userRow({
        id: 'student',
        role: 'STUDENT',
        name: '가나다 학생',
        studentId: null,
        department: '소프트웨어공학과',
        pendingRequest: null,
      }),
    );
    const detail = toDetail(
      await new AdminAccessReadRepository(
        new AdminAccessReadOrderingRepository(),
      ).findAdminAccessUserById(prisma, 'student'),
    );
    expect(detail).toMatchObject({
      isProfileComplete: false,
      profile: { isComplete: false },
    });
  });
  it('keeps an unassigned user without a live request on the student baseline', async () => {
    const prisma = prismaReturning(
      userRow({
        id: 'unassigned',
        role: null,
        name: '가나다 미배정',
        studentId: null,
        department: '소프트웨어공학과',
        pendingRequest: null,
      }),
    );
    const detail = toDetail(
      await new AdminAccessReadRepository(
        new AdminAccessReadOrderingRepository(),
      ).findAdminAccessUserById(prisma, 'unassigned'),
    );
    expect(detail).toMatchObject({
      isProfileComplete: false,
      profile: { isComplete: false },
    });
  });
  it('treats a revoked staff member without a student id as complete', async () => {
    const prisma = prismaReturning(
      userRow({
        id: 'revoked-staff',
        role: null,
        selectedRole: 'STAFF',
        name: '가나다 교직원',
        studentId: null,
        department: '소프트웨어공학과',
        pendingRequest: null,
      }),
    );
    const detail = toDetail(
      await new AdminAccessReadRepository(
        new AdminAccessReadOrderingRepository(),
      ).findAdminAccessUserById(prisma, 'revoked-staff'),
    );
    expect(detail).toMatchObject({
      id: 'revoked-staff',
      role: null,
      isProfileComplete: true,
      profile: { studentId: null, isComplete: true },
    });
  });
  it('keeps a user who selected the student role without a student id incomplete', async () => {
    const prisma = prismaReturning(
      userRow({
        id: 'selected-student',
        role: null,
        name: '가나다 학생',
        studentId: null,
        department: '소프트웨어공학과',
        pendingRequest: null,
      }),
    );
    const detail = toDetail(
      await new AdminAccessReadRepository(
        new AdminAccessReadOrderingRepository(),
      ).findAdminAccessUserById(prisma, 'selected-student'),
    );
    expect(detail).toMatchObject({
      isProfileComplete: false,
      profile: { isComplete: false },
    });
  });
  it('reads only approved, live team memberships and maps them to participations', async () => {
    const prisma = prismaReturning({
      ...userRow({
        id: 'student',
        role: 'STUDENT',
        name: '가나다 학생',
        studentId: '202601',
        department: '소프트웨어공학과',
        pendingRequest: null,
      }),
      teamMemberships: [
        {
          team: {
            name: '합성 팀',
            leaderId: 'student',
            program: { id: 'program-1', name: '합성 프로그램' },
          },
        },
        {
          team: {
            name: '다른 합성 팀',
            leaderId: 'other-student',
            program: { id: 'program-2', name: '다른 합성 프로그램' },
          },
        },
      ],
    });
    const detail = toDetail(
      await new AdminAccessReadRepository(
        new AdminAccessReadOrderingRepository(),
      ).findAdminAccessUserById(prisma, 'student'),
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          teamMemberships: {
            take: 201,
            where: {
              team: {
                status: 'APPROVED',
                archivedAt: null,
                program: { lifecycle: { not: 'DELETED' } },
              },
            },
            orderBy: [
              { team: { program: { startAt: 'desc' } } },
              { programId: 'asc' },
            ],
            select: {
              team: {
                select: {
                  name: true,
                  leaderId: true,
                  program: { select: { id: true, name: true } },
                },
              },
            },
          },
        }) as unknown,
      }),
    );
    expect(detail?.participations).toEqual([
      {
        programId: 'program-1',
        programName: '합성 프로그램',
        teamName: '합성 팀',
        isLeader: true,
      },
      {
        programId: 'program-2',
        programName: '다른 합성 프로그램',
        teamName: '다른 합성 팀',
        isLeader: false,
      },
    ]);
    expect(detail).not.toHaveProperty('participationMemberships');
  });
  it('leaves the pending-request projection untouched for a revoked staff member', async () => {
    const prisma = prismaReturning(
      userRow({
        id: 'revoked-staff-projection',
        role: null,
        name: '가나다 교직원',
        studentId: null,
        department: '소프트웨어공학과',
        pendingRequest: null,
      }),
    );
    const detail = toDetail(
      await new AdminAccessReadRepository(
        new AdminAccessReadOrderingRepository(),
      ).findAdminAccessUserById(prisma, 'revoked-staff-projection'),
    );
    expect(detail?.pendingRequest).toBeNull();
  });
  it('projects the account creation time separately from a pending request time', () => {
    const accountCreatedAt = new Date('2026-07-18T00:00:00.000Z');
    const requestCreatedAt = new Date('2026-07-23T00:00:00.000Z');
    const record = toRecord(
      userRow({
        id: 'pending-staff-created-at',
        role: null,
        name: '가나다 교직원',
        studentId: null,
        department: '소프트웨어공학과',
        createdAt: accountCreatedAt,
        pendingRequest: { ...pendingRequest(), createdAt: requestCreatedAt },
      }),
    );
    expect(record.createdAt).toEqual(accountCreatedAt);
    expect(record.pendingRequest?.createdAt).toEqual(requestCreatedAt);
  });
  it('lets an admin approve a pending staff request that has no student id', () => {
    const before = toRecord(
      userRow({
        id: 'pending-staff',
        role: null,
        name: '가나다 교직원',
        studentId: null,
        department: '소프트웨어공학과',
        pendingRequest: pendingRequest(),
      }),
    );
    const approval = approveStaffTransition();
    expect(approval.outcome.requiresCompleteProfile).toBe(true);
    expect(() =>
      adminAccessMutationService.enforceAdminAccessGuards(
        actor(),
        before,
        approveStaffCommand(),
        approval.outcome,
        2,
      ),
    ).not.toThrow();
  });
  it.each<'STAFF' | 'STUDENT' | null>([null, 'STAFF', 'STUDENT'])(
    'keeps the approval gate identical when the selected role is %s',
    (selectedRole) => {
      const before = toRecord(
        userRow({
          id: 'pending-staff-gate',
          role: null,
          selectedRole,
          name: '가나다 교직원',
          studentId: null,
          department: null,
          pendingRequest: pendingRequest(),
        }),
      );
      expect(before.isProfileComplete).toBe(false);
      expect(() =>
        adminAccessMutationService.enforceAdminAccessGuards(
          actor(),
          before,
          approveStaffCommand(),
          approveStaffTransition().outcome,
          2,
        ),
      ).toThrow(DomainException);
    },
  );
  it('still blocks approval when the staff profile misses a required field', () => {
    const before = toRecord(
      userRow({
        id: 'pending-staff-no-department',
        role: null,
        name: '가나다 교직원',
        studentId: null,
        department: null,
        pendingRequest: pendingRequest(),
      }),
    );
    const approval = approveStaffTransition();
    let thrown: unknown;
    try {
      adminAccessMutationService.enforceAdminAccessGuards(
        actor(),
        before,
        approveStaffCommand(),
        approval.outcome,
        2,
      );
    } catch (error) {
      thrown = error;
    }
    expect(before.isProfileComplete).toBe(false);
    expect(thrown).toBeInstanceOf(DomainException);
    expect(thrown).toMatchObject({
      errorCode: { code: UsersErrorCode.PROFILE_INCOMPLETE, status: 409 },
    });
  });
});
function approveStaffTransition() {
  const transition = adminAccessMutationService.resolveAdminAccessTransition(
    {
      role: 'STUDENT',
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.PENDING,
    },
    {
      role: 'STAFF',
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.APPROVE,
    },
  );
  if (!transition.outcome.allowed) {
    throw new Error('Expected the staff approval transition to be allowed');
  }
  return { outcome: transition.outcome };
}
function approveStaffCommand(): AdminAccessMutationCommand {
  return {
    expectedRole: null,
    desiredRole: 'STAFF',
    expectedAccountStatus: AccountStatus.ACTIVE,
    desiredAccountStatus: AccountStatus.ACTIVE,
    expectedPendingRequest: {
      id: 'request-pending',
      status: StaffAccessRequestStatus.PENDING,
    },
    requestDecision: { decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE },
  };
}
function actor(): AdminAccessActor {
  return {
    id: 'synthetic-admin',
    githubId: 910000001n,
    githubLogin: 'synthetic-admin',
    name: null,
    memberKind: null,
    approvalStatus: 'NOT_REQUIRED',
    profileCreatedAt: null,
    department: null,
    hasAdminAccess: true,
    accountStatus: AccountStatus.ACTIVE,
  };
}
function pendingRequest() {
  return {
    id: 'request-pending',
    status: StaffAccessRequestStatus.PENDING,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
  };
}
type UserRowOptions = {
  readonly id: string;
  readonly role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly pendingRequest: ReturnType<typeof pendingRequest> | null;
  readonly selectedRole?: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  readonly createdAt?: Date;
};
function userRow(options: UserRowOptions): AdminAccessUserDetailSource {
  const facts = authorityFactsFor(options.role);
  const hasProfile = options.name !== null && options.department !== null;
  const type =
    options.role === 'STAFF' ||
    options.selectedRole === 'STAFF' ||
    (options.role === null && options.pendingRequest !== null)
      ? MemberKind.STAFF
      : MemberKind.STUDENT;
  const at = new Date('2026-07-19T00:00:00.000Z');
  return {
    id: options.id,
    githubId: BigInt('92' + options.id.length + '000001'),
    nickname: 'synthetic-' + options.id,
    name: hasProfile ? options.name : null,
    studentId: hasProfile ? options.studentId : null,
    department: hasProfile ? options.department : null,
    staffNumber: null,
    type,
    departmentType:
      type === 'STUDENT'
        ? DepartmentType.DEPARTMENT
        : DepartmentType.PROGRAM_OFFICE,
    profileCreatedAt: hasProfile ? at : null,
    profileUpdatedAt: hasProfile ? at : null,
    approvalStatus: options.pendingRequest
      ? 'PENDING'
      : facts.hasStaffAccess
        ? 'APPROVED'
        : type === 'STAFF'
          ? 'REVOKED'
          : 'NOT_REQUIRED',
    approvalRequestId: options.pendingRequest?.id ?? null,
    approvalRequestedAt: options.pendingRequest?.createdAt ?? null,
    approvalDecidedAt: null,
    approvalDecidedById: null,
    approvalReason: null,
    admin: facts.hasAdminAccess ? { userId: options.id } : null,
    accountStatus: AccountStatus.ACTIVE,
    createdAt: options.createdAt ?? at,
    loginHistories: [],
    teamMemberships: [],
  };
}
function prismaReturning(row: ReturnType<typeof userRow>) {
  return Object.assign(new PrismaService(), {
    user: { findUnique: jest.fn().mockResolvedValue(row) },
  });
}
