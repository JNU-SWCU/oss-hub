import { AccountStatus, AffiliationKind, MemberKind } from '@prisma/client';
import {
  INDEPENDENT_AUTHORITY_AUDIT_ACTIONS,
  USER_PROFILE_AUDIT_ACTIONS,
} from '../audit-log/domain/audit-log-metadata';
import { PrismaService } from '../prisma/prisma.service';
import { DomainException } from '../common/error-code';
import type { AdminAccessActor } from './admin-access.repository.types';
import type {
  MemberKindProfileUpdate,
  MemberKindRepositoryPort,
  MemberKindTargetRecord,
  MemberKindTransactionStore,
} from './member-kind.repository';
import { MemberKindService } from './member-kind.service';

const ADMIN_GITHUB_ID = 9_700_500_001n;
const TARGET_GITHUB_ID = 9_700_500_002n;

class InMemoryMemberKindRepository
  implements MemberKindRepositoryPort, MemberKindTransactionStore
{
  readonly auditLogWriter = new PrismaService();
  actor: AdminAccessActor | null = adminActor();
  target: MemberKindTargetRecord | null = studentTarget();
  readonly updates: Array<{
    readonly userId: string;
    readonly hasStaffAccess: boolean;
    readonly selectedMemberKind: MemberKind;
    readonly profile: MemberKindProfileUpdate;
  }> = [];
  readonly revocations: Array<{
    readonly userId: string;
    readonly actorId: string;
  }> = [];

  withTransaction<T>(
    operation: (store: MemberKindTransactionStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  lockActiveAdmins(): Promise<void> {
    return Promise.resolve();
  }

  findActorByGithubId(): Promise<AdminAccessActor | null> {
    return Promise.resolve(this.actor);
  }

  findTargetForUpdate(): Promise<MemberKindTargetRecord | null> {
    return Promise.resolve(this.target);
  }

  updateMemberKind(
    userId: string,
    hasStaffAccess: boolean,
    selectedMemberKind: MemberKind,
    profile: MemberKindProfileUpdate,
  ): Promise<'updated' | 'studentIdTaken'> {
    this.updates.push({
      userId,
      hasStaffAccess,
      selectedMemberKind,
      profile,
    });
    const current = this.target;
    if (!current?.profile) {
      throw new Error('synthetic store expected a profile');
    }
    const nextProfile = { ...current.profile, ...profile };
    this.target = {
      ...current,
      selectedMemberKind,
      memberKind: selectedMemberKind,
      hasStaffAccess,
      role: current.hasAdminAccess
        ? 'ADMIN'
        : hasStaffAccess
          ? 'STAFF'
          : selectedMemberKind === MemberKind.STUDENT
            ? 'STUDENT'
            : null,
      profile: nextProfile,
    };
    return Promise.resolve('updated');
  }

  insertRevokedRequest(input: {
    readonly userId: string;
    readonly actorId: string;
    readonly decidedAt: Date;
  }): Promise<{ readonly id: string }> {
    this.revocations.push(input);
    return Promise.resolve({ id: `revoked-${this.revocations.length}` });
  }
}

describe('MemberKindService', () => {
  it('maps STAFF to access=true, preserves studentId, and treats staffNumber as opaque text', async () => {
    const repository = new InMemoryMemberKindRepository();
    const audit = auditHarness();
    const service = new MemberKindService(repository, audit);

    await expect(
      service.patchMemberKind(ADMIN_GITHUB_ID, 'target', {
        memberKind: MemberKind.STAFF,
        expectedMemberKind: MemberKind.STUDENT,
        expectedHasStaffAccess: false,
        staffNumber: ' 직원-A7 ',
      }),
    ).resolves.toMatchObject({
      id: 'target',
      role: 'STAFF',
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      hasAdminAccess: false,
    });
    expect(repository.target?.profile).toMatchObject({
      studentId: '123456',
      memberKind: MemberKind.STAFF,
      staffNumber: '직원-A7',
    });

    await expect(
      service.patchMemberKind(ADMIN_GITHUB_ID, 'target', {
        memberKind: MemberKind.STAFF,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        staffNumber: null,
      }),
    ).resolves.toMatchObject({ hasStaffAccess: true });
    expect(repository.target?.profile?.staffNumber).toBeNull();
    expect(repository.revocations).toHaveLength(0);
    expect(audit.record).toHaveBeenCalledTimes(3);
    expect(audit.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: INDEPENDENT_AUTHORITY_AUDIT_ACTIONS.SET_MEMBER_KIND,
      }),
      expect.anything(),
    );
    expect(audit.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
      }),
      expect.anything(),
    );
    expect(audit.record).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
      }),
      expect.anything(),
    );
  });

  it('repairs a same-kind STAFF row with a missing access flag without adding revocation history', async () => {
    const repository = new InMemoryMemberKindRepository();
    repository.target = staffTarget({ hasStaffAccess: false });
    const audit = auditHarness();
    const service = new MemberKindService(repository, audit);

    await expect(
      service.patchMemberKind(ADMIN_GITHUB_ID, 'target', {
        memberKind: MemberKind.STAFF,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: false,
      }),
    ).resolves.toMatchObject({
      role: 'STAFF',
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
    });
    expect(repository.revocations).toHaveLength(0);
    expect(repository.target?.hasStaffAccess).toBe(true);
  });

  it('adds one revoked history row only when staff access changes true to false', async () => {
    const repository = new InMemoryMemberKindRepository();
    repository.target = staffTarget();
    const service = new MemberKindService(repository, auditHarness());

    await expect(
      service.patchMemberKind(ADMIN_GITHUB_ID, 'target', {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        department: ' 소프트웨어공학과 ',
      }),
    ).resolves.toMatchObject({
      role: 'STUDENT',
      memberKind: MemberKind.STUDENT,
      hasStaffAccess: false,
    });
    expect(repository.revocations).toHaveLength(1);
    expect(repository.revocations[0]).toMatchObject({
      userId: 'target',
      actorId: 'actor',
    });
    expect(repository.target?.profile).toMatchObject({
      studentId: '123456',
      department: '소프트웨어공학과',
      affiliationName: '소프트웨어공학과',
      affiliationKind: AffiliationKind.DEPARTMENT,
    });
  });

  it.each([
    ['missing user', null, 'ROL_010', 404],
    [
      'missing canonical profile',
      { ...staffTarget(), profile: null },
      'USR_002',
      409,
    ],
    ['missing studentId', staffTarget({ studentId: null }), 'USR_002', 409],
  ] as const)(
    '%s blocks a STUDENT transition without writing',
    async (_label, target, code, status) => {
      const repository = new InMemoryMemberKindRepository();
      repository.target = target;
      const service = new MemberKindService(repository, auditHarness());

      const error = await captureDomainException(() =>
        service.patchMemberKind(ADMIN_GITHUB_ID, 'target', {
          memberKind: MemberKind.STUDENT,
          expectedMemberKind: MemberKind.STAFF,
          expectedHasStaffAccess: true,
          department: '소프트웨어공학과',
        }),
      );

      expect(error.errorCode).toMatchObject({ code, status });
      expect(repository.updates).toHaveLength(0);
    },
  );

  it('requires a department when a valid existing studentId is used for a STUDENT transition', async () => {
    const repository = new InMemoryMemberKindRepository();
    repository.target = staffTarget();
    const service = new MemberKindService(repository, auditHarness());

    const error = await captureDomainException(() =>
      service.patchMemberKind(ADMIN_GITHUB_ID, 'target', {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
      }),
    );

    expect(error.errorCode).toMatchObject({ code: 'USR_005', status: 400 });
    expect(repository.updates).toHaveLength(0);
  });

  it('rejects a supplied studentId that replaces an existing studentId without writing', async () => {
    const repository = new InMemoryMemberKindRepository();
    repository.target = staffTarget({ studentId: '123456' });
    const audit = auditHarness();
    const service = new MemberKindService(repository, audit);

    const error = await captureDomainException(() =>
      service.patchMemberKind(ADMIN_GITHUB_ID, 'target', {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        studentId: '654321',
        department: '소프트웨어공학과',
      }),
    );

    expect(error.errorCode).toMatchObject({ code: 'SYS_003', status: 400 });
    expect(repository.updates).toHaveLength(0);
    expect(repository.revocations).toHaveLength(0);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('accepts a matching studentId and fills a missing studentId during a STUDENT transition', async () => {
    const matchingRepository = new InMemoryMemberKindRepository();
    matchingRepository.target = staffTarget({ studentId: '123456' });
    const matchingService = new MemberKindService(
      matchingRepository,
      auditHarness(),
    );

    await expect(
      matchingService.patchMemberKind(ADMIN_GITHUB_ID, 'target', {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        studentId: '123456',
        department: '소프트웨어공학과',
      }),
    ).resolves.toMatchObject({ memberKind: MemberKind.STUDENT });
    expect(matchingRepository.target?.profile?.studentId).toBe('123456');

    const missingRepository = new InMemoryMemberKindRepository();
    missingRepository.target = staffTarget({ studentId: null });
    const missingService = new MemberKindService(
      missingRepository,
      auditHarness(),
    );

    await expect(
      missingService.patchMemberKind(ADMIN_GITHUB_ID, 'target', {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        studentId: '654321',
        department: '소프트웨어공학과',
      }),
    ).resolves.toMatchObject({ memberKind: MemberKind.STUDENT });
    expect(missingRepository.target?.profile?.studentId).toBe('654321');
  });

  it('rejects a newly supplied invalid studentId before persistence', async () => {
    const repository = new InMemoryMemberKindRepository();
    repository.target = staffTarget();
    const service = new MemberKindService(repository, auditHarness());

    const error = await captureDomainException(() =>
      service.patchMemberKind(ADMIN_GITHUB_ID, 'target', {
        memberKind: MemberKind.STUDENT,
        expectedMemberKind: MemberKind.STAFF,
        expectedHasStaffAccess: true,
        studentId: 'not-a-student-id',
        department: '소프트웨어공학과',
      }),
    );

    expect(error.errorCode).toMatchObject({ code: 'SYS_003', status: 400 });
    expect(repository.updates).toHaveLength(0);
  });

  it.each([
    ['non-admin actor', { hasAdminAccess: false }, 'ROL_004', 403],
    [
      'stale expectation',
      { target: studentTarget(), expected: true },
      'ROL_013',
      409,
    ],
    [
      'pending request',
      {
        target: studentTarget({ pendingRequest: pendingRequest() }),
        expected: false,
      },
      'ROL_015',
      409,
    ],
  ] as const)(
    '%s is rejected without a mutation',
    async (_label, options, code, status) => {
      const repository = new InMemoryMemberKindRepository();
      if ('hasAdminAccess' in options) {
        repository.actor = adminActor({
          hasAdminAccess: options.hasAdminAccess,
          hasStaffAccess: false,
        });
      }
      if ('target' in options) {
        repository.target = options.target;
      }
      const service = new MemberKindService(repository, auditHarness());
      const expectedHasStaffAccess =
        'expected' in options ? options.expected : false;

      const error = await captureDomainException(() =>
        service.patchMemberKind(ADMIN_GITHUB_ID, 'target', {
          memberKind: MemberKind.STAFF,
          expectedMemberKind: MemberKind.STUDENT,
          expectedHasStaffAccess,
          staffNumber: '합성-번호',
        }),
      );

      expect(error.errorCode).toMatchObject({ code, status });
      expect(repository.updates).toHaveLength(0);
      expect(repository.revocations).toHaveLength(0);
    },
  );
});

function adminActor(
  overrides: Partial<AdminAccessActor> = {},
): AdminAccessActor {
  return {
    id: 'actor',
    githubId: ADMIN_GITHUB_ID,
    githubLogin: 'synthetic-admin',
    name: '합성 관리자',
    role: 'ADMIN',
    hasStaffAccess: true,
    hasAdminAccess: true,
    accountStatus: AccountStatus.ACTIVE,
    ...overrides,
  };
}

function profile(
  overrides: Partial<NonNullable<MemberKindTargetRecord['profile']>> = {},
): NonNullable<MemberKindTargetRecord['profile']> {
  return {
    name: '합성 사용자',
    studentId: '123456',
    department: '합성 학과',
    staffNumber: null,
    memberKind: MemberKind.STUDENT,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: '합성 학과',
    ...overrides,
  };
}

function studentTarget(
  overrides: Partial<MemberKindTargetRecord> = {},
): MemberKindTargetRecord {
  return {
    id: 'target',
    githubId: TARGET_GITHUB_ID,
    githubLogin: 'synthetic-target',
    name: '합성 사용자',
    role: 'STUDENT',
    selectedMemberKind: MemberKind.STUDENT,
    memberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
    profile: profile(),
    pendingRequest: null,
    ...overrides,
  };
}

function staffTarget(
  overrides: Partial<NonNullable<MemberKindTargetRecord['profile']>> &
    Partial<
      Pick<MemberKindTargetRecord, 'hasStaffAccess' | 'pendingRequest'>
    > = {},
): MemberKindTargetRecord {
  const {
    hasStaffAccess = true,
    pendingRequest = null,
    ...profileOverrides
  } = overrides;
  return studentTarget({
    role: 'STAFF',
    selectedMemberKind: MemberKind.STAFF,
    memberKind: MemberKind.STAFF,
    hasStaffAccess,
    profile: profile({
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      ...profileOverrides,
    }),
    pendingRequest,
  });
}

function pendingRequest() {
  return {
    id: 'pending',
    status: 'PENDING' as const,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function auditHarness() {
  return { record: jest.fn().mockResolvedValue({}) };
}

async function captureDomainException(
  operation: () => Promise<unknown>,
): Promise<DomainException> {
  try {
    await operation();
  } catch (error: unknown) {
    if (error instanceof DomainException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected DomainException');
}
