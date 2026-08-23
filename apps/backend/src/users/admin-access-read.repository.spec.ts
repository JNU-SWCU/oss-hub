import { authorityFactsFor } from './canonical-user-fixture';
import { AccountStatus, AffiliationKind, MemberKind, StaffAccessRequestStatus } from '@prisma/client';
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
        memberKind: MemberKind.STAFF,
        affiliationKind: AffiliationKind.PROGRAM_OFFICE,
        affiliationName: '소프트웨어공학과',
        isComplete: true,
      },
    });
  });

  it('keeps a student without a student id incomplete', async () => {
    // Given
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

  /**
   * 회수된 교직원은 **관리자 화면에서도 완료다** (#184).
   *
   * 그는 세 근거 중 앞의 둘에 걸리지 않는다 — `role`은 회수로 비었고 살아 있는 요청도
   * 없다. 남은 근거인 고른 역할을 넘기지 않으면 학번 없는 그의 프로필이 학생 기준으로
   * 떨어져 미완료로 뜨는데, 본인 화면은 완료로 보여 준다. 한 사람이 두 화면에서 다르게
   * 보이는 그 어긋남을 이 검사가 막는다.
   *
   * 위 `keeps an unassigned user without a live request on the student baseline`와
   * 짝이다 — 고른 역할까지 **없는** 사람은 여전히 학생 기준(fail-closed)이다.
   */
  it('treats a revoked staff member without a student id as complete', async () => {
    // Given: 회수 직후의 행 — 역할은 비었고, 대기 요청도 없고, 고른 역할만 남아 있다.
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

    // When
    const detail = await findAdminAccessUserById(prisma, 'revoked-staff');

    // Then
    expect(detail).toMatchObject({
      id: 'revoked-staff',
      role: null,
      isProfileComplete: true,
      profile: { studentId: null, isComplete: true },
    });
  });

  /**
   * 고른 역할이 학생이면 학번은 여전히 필수다 — 셋째 근거를 넘긴 것이지 판정을 느슨하게
   * 한 것이 아니다.
   */
  it('keeps a user who selected the student role without a student id incomplete', async () => {
    // Given
    const prisma = prismaReturning(
      userRow({
        id: 'selected-student',
        role: null,
        selectedRole: 'STUDENT',
        name: '가나다 학생',
        studentId: null,
        department: '소프트웨어공학과',
        pendingRequest: null,
      }),
    );

    // When
    const detail = await findAdminAccessUserById(prisma, 'selected-student');

    // Then
    expect(detail).toMatchObject({
      isProfileComplete: false,
      profile: { isComplete: false },
    });
  });

  /**
   * `ADMIN_ACCESS_USER_SELECT`를 넓힌 것이 `staffAccessRequests` 소비자를 건드리지 않았다.
   *
   * 그 배열은 PENDING만 골라 오고 두 곳이 읽는다 — 하나는 `pendingRequest`(승인·반려
   * 버튼의 근거이며 status를 PENDING으로 하드코딩한다), 다른 하나는
   * `hasPendingStaffRequest`다. 회수된 교직원은 대기 요청이 없으므로 **승인 대기가
   * 아닌 사람에게 결정 버튼이 뜨면 안 된다.**
   */
  it('leaves the pending-request projection untouched for a revoked staff member', async () => {
    // Given
    const prisma = prismaReturning(
      userRow({
        id: 'revoked-staff-projection',
        role: null,
        selectedRole: 'STAFF',
        name: '가나다 교직원',
        studentId: null,
        department: '소프트웨어공학과',
        pendingRequest: null,
      }),
    );

    // When
    const detail = await findAdminAccessUserById(
      prisma,
      'revoked-staff-projection',
    );

    // Then
    expect(detail?.pendingRequest).toBeNull();
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
      enforceAdminAccessGuards(
        actor(),
        before,
        approveStaffCommand(),
        approval.outcome,
        2,
      ),
    ).not.toThrow();
  });

  /**
   * 승인 게이트는 셋째 근거를 더해도 그대로다.
   *
   * `requiresCompleteProfile`은 요청을 승인하는 전이 하나에만 붙고 그 전이는 PENDING
   * 요청을 전제한다. 그런 사용자는 둘째 근거(`hasPendingStaffRequest`)로 이미 교직원
   * 기준을 받고 있었으므로, 고른 역할이 무엇이든 판정이 달라질 수 없다 — 이 검사가
   * 없으면 "게이트가 느슨해지지 않았다"는 주장이 코드 어디에도 적혀 있지 않다.
   */
  it.each<'STAFF' | 'STUDENT' | null>([null, 'STAFF', 'STUDENT'])(
    'keeps the approval gate identical when the selected role is %s',
    (selectedRole) => {
      // Given: 학과가 빠진 승인 대기 교직원 — 게이트가 막아야 하는 사람이다.
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

      // Then
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
    hasAdminAccess: true,
    hasStaffAccess: true,
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
};

/**
 * 프로필 행은 이름·소속이 모두 있을 때만 만든다 — 계약 스키마에서 세 canonical 칸이
 * NOT NULL이라 "행은 있는데 이름만 비어 있는" 상태가 존재하지 않는다.
 */
function userRow(options: UserRowOptions) {
  const facts = authorityFactsFor(options.role);
  const hasProfile = options.name !== null && options.department !== null;
  const memberKind =
    options.studentId === null ? MemberKind.STAFF : MemberKind.STUDENT;
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
