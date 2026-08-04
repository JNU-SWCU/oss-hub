import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import type { PrismaService } from '../prisma/prisma.service';
import {
  findAdminAccessUserById,
  toAdminAccessUserRecord,
} from './admin-access-read.store';
import { enforceAdminAccessGuards } from './admin-access-mutation-policy';
import {
  ADMIN_ACCESS_DECISION_KINDS,
  ADMIN_ACCESS_PENDING_STATES,
  resolveAdminAccessTransition,
} from './admin-access-transition-table';
import type { AdminAccessActor } from './admin-access.repository.types';
import { UsersErrorCode } from './users-error-code.enum';

/**
 * 관리자 목록·상세의 프로필 완료 판정은 역할 맥락 위에서 이뤄져야 한다(#577).
 *
 * 교직원은 관리자가 승인해야 `role`에 STAFF가 붙는다. 승인 전에는 `role`이 null이라
 * 역할 맥락 없이 판정하면 전원이 가장 엄격한 학생 기준으로 떨어지고, 화면 안내대로
 * 학번을 비워 둔 교직원이 미완료로 판정돼 승인 자체가 막힌다.
 */
describe('admin access read profile completeness', () => {
  it('treats a pending staff request without a student id as complete', async () => {
    // Given
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

    // When
    const detail = await findAdminAccessUserById(prisma, 'pending-staff');

    // Then
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
    // Given
    const prisma = prismaReturning(
      userRow({
        id: 'student',
        role: Role.STUDENT,
        name: '가나다 학생',
        studentId: null,
        department: '소프트웨어공학과',
        pendingRequest: null,
      }),
    );

    // When
    const detail = await findAdminAccessUserById(prisma, 'student');

    // Then
    expect(detail).toMatchObject({
      isProfileComplete: false,
      profile: { isComplete: false },
    });
  });

  it('keeps an unassigned user without a live request on the student baseline', async () => {
    // Given — 역할도 없고 살아 있는 요청도 없으면 기준 역할을 알 수 없다(fail-closed).
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

    // When
    const detail = await findAdminAccessUserById(prisma, 'unassigned');

    // Then
    expect(detail).toMatchObject({
      isProfileComplete: false,
      profile: { isComplete: false },
    });
  });

  it('lets an admin approve a pending staff request that has no student id', () => {
    // Given
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

    // When / Then
    expect(approval.outcome.requiresCompleteProfile).toBe(true);
    expect(() =>
      enforceAdminAccessGuards(actor(), before, approval.outcome, 2),
    ).not.toThrow();
  });

  it('still blocks approval when the staff profile misses a required field', () => {
    // Given — 학과는 교직원에게도 필수다. 가드를 없앤 것이 아니라 기준 역할만 바로잡았다.
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

    // When
    let thrown: unknown;
    try {
      enforceAdminAccessGuards(actor(), before, approval.outcome, 2);
    } catch (error) {
      thrown = error;
    }

    // Then
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
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.PENDING,
    },
    {
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.APPROVE,
    },
  );
  if (!transition.outcome.allowed) {
    throw new Error('Expected the staff approval transition to be allowed');
  }
  return { outcome: transition.outcome };
}

function actor(): AdminAccessActor {
  return {
    id: 'synthetic-admin',
    githubId: 910_000_001n,
    githubLogin: 'synthetic-admin',
    name: '가나다 관리자',
    role: Role.ADMIN,
    accountStatus: AccountStatus.ACTIVE,
  };
}

function pendingRequest() {
  return {
    id: 'request-pending',
    status: RoleRequestStatus.PENDING,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
  };
}

type UserRowOptions = {
  readonly id: string;
  readonly role: Role | null;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly pendingRequest: ReturnType<typeof pendingRequest> | null;
};

/**
 * 학번 없는 교직원은 UserProfile 행을 만들 수 없어(studentId NOT NULL) 구버전 User
 * 컬럼에만 남는다 — `resolveCompatibleProfile`이 그때 User 컬럼으로 떨어진다.
 */
function userRow(options: UserRowOptions) {
  return {
    id: options.id,
    githubId: BigInt(`92${options.id.length}000001`),
    nickname: `synthetic-${options.id}`,
    name: options.name,
    studentId: options.studentId,
    department: options.department,
    profile: null,
    role: options.role,
    accountStatus: AccountStatus.ACTIVE,
    roleRequests: options.pendingRequest ? [options.pendingRequest] : [],
    loginHistories: [],
  };
}

function prismaReturning(row: ReturnType<typeof userRow>) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(row) },
  } as unknown as PrismaService;
}
