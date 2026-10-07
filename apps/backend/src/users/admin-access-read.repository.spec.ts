import { authorityFactsFor } from './canonical-user-fixture';
import {
  AccountStatus,
  AffiliationKind,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { DomainException } from '../common/error-code';
import type { PrismaService } from '../prisma/prisma.service';
import {
  findAdminAccessUserById,
  toAdminAccessUserRecord,
} from './admin-access-read.repository';
import { enforceAdminAccessGuards } from './admin-access-mutation-policy';
import {
  ADMIN_ACCESS_DECISION_KINDS,
  ADMIN_ACCESS_PENDING_STATES,
  resolveAdminAccessTransition,
} from './admin-access-transition-table';
import type { AdminAccessActor } from './admin-access.repository.types';
import {
  ADMIN_ACCESS_REQUEST_DECISIONS,
  type AdminAccessMutationCommand,
} from './domain/admin-access';
import { UsersErrorCode } from './users-error-code.enum';

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

    const detail = await findAdminAccessUserById(prisma, 'pending-staff');

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

    const detail = await findAdminAccessUserById(prisma, 'student');

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

    const detail = await findAdminAccessUserById(prisma, 'unassigned');

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

    const detail = await findAdminAccessUserById(prisma, 'revoked-staff');

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

    const detail = await findAdminAccessUserById(prisma, 'selected-student');

    expect(detail).toMatchObject({
      isProfileComplete: false,
      profile: { isComplete: false },
    });
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

    const detail = await findAdminAccessUserById(
      prisma,
      'revoked-staff-projection',
    );

    expect(detail?.pendingRequest).toBeNull();
  });

  it('projects the account creation time separately from a pending request time', () => {
    const accountCreatedAt = new Date('2026-07-18T00:00:00.000Z');
    const requestCreatedAt = new Date('2026-07-23T00:00:00.000Z');

    const record = toAdminAccessUserRecord(
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
    const before = toAdminAccessUserRecord(
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
      enforceAdminAccessGuards(
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
      const before = toAdminAccessUserRecord(
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
        enforceAdminAccessGuards(
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
    const before = toAdminAccessUserRecord(
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
      enforceAdminAccessGuards(
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
  const transition = resolveAdminAccessTransition(
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
    githubId: 910_000_001n,
    githubLogin: 'synthetic-admin',
    name: null,
    role: 'ADMIN',
    hasStaffAccess: false,
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

function userRow(options: UserRowOptions) {
  const facts = authorityFactsFor(options.role);
  const hasProfile = options.name !== null && options.department !== null;

  const memberKind =
    options.role === 'STAFF' ||
    options.selectedRole === 'STAFF' ||
    (options.role === null && options.pendingRequest !== null)
      ? MemberKind.STAFF
      : MemberKind.STUDENT;
  return {
    id: options.id,
    githubId: BigInt(`92${options.id.length}000001`),
    nickname: `synthetic-${options.id}`,
    profile: hasProfile
      ? {
          name: options.name,
          studentId: options.studentId,
          department: options.department,
          memberKind,
          affiliationKind:
            memberKind === MemberKind.STUDENT
              ? AffiliationKind.DEPARTMENT
              : AffiliationKind.PROGRAM_OFFICE,
          affiliationName: options.department,
        }
      : null,
    selectedMemberKind:
      options.selectedRole === 'ADMIN'
        ? null
        : (options.selectedRole ?? facts.selectedMemberKind),
    createdAt: options.createdAt ?? new Date('2026-07-19T00:00:00.000Z'),
    hasStaffAccess: facts.hasStaffAccess,
    hasAdminAccess: facts.hasAdminAccess,
    accountStatus: AccountStatus.ACTIVE,
    staffAccessRequests: options.pendingRequest ? [options.pendingRequest] : [],
    loginHistories: [],
  };
}

function prismaReturning(row: ReturnType<typeof userRow>) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(row) },
  } as unknown as PrismaService;
}
