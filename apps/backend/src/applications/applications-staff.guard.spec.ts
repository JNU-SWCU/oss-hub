import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AccountStatus, Role } from '@prisma/client';
import {
  ApplicationsStaffGuard,
  ApplicationsStaffListGuard,
} from './applications-staff.guard';
import { ApplicationsErrorCode } from './applications-error-code.enum';

describe('ApplicationsStaffGuard', () => {
  const findUnique = jest.fn();
  const prisma = {
    user: { findUnique },
  };
  const guard = new ApplicationsStaffGuard(prisma);

  beforeEach(() => findUnique.mockReset());

  it.each([
    ['staff', { hasStaffAccess: true, hasAdminAccess: false }],
    ['admin', { hasStaffAccess: false, hasAdminAccess: true }],
  ])('canonical %s 접근권을 허용하고 처리자 ID를 붙인다', async (_label, access) => {
    // Given
    findUnique.mockResolvedValue({
      id: 'synthetic-actor',
      role: null,
      ...access,
      accountStatus: AccountStatus.ACTIVE,
    });
    const request: {
      sessionGithubId: bigint;
      applicationActorId?: string;
    } = { sessionGithubId: 1001n };
    const context = new ExecutionContextHost([request]);
    context.setType('http');

    // When
    const allowed = await guard.canActivate(context);

    // Then
    expect(allowed).toBe(true);
    expect(request.applicationActorId).toBe('synthetic-actor');
  });

  it.each([Role.STAFF, Role.ADMIN])(
    'canonical 컬럼이 비어 있으면 legacy %s 역할로 허용한다',
    async (role) => {
      // Given
      findUnique.mockResolvedValue({
        id: 'synthetic-actor',
        role,
        hasStaffAccess: null,
        hasAdminAccess: null,
        accountStatus: AccountStatus.ACTIVE,
      });
      const request: {
        sessionGithubId: bigint;
        applicationActorId?: string;
      } = { sessionGithubId: 1001n };
      const context = new ExecutionContextHost([request]);
      context.setType('http');

      // When
      const allowed = await guard.canActivate(context);

      // Then
      expect(allowed).toBe(true);
      expect(request.applicationActorId).toBe('synthetic-actor');
    },
  );

  it('legacy 역할이 STAFF여도 canonical 접근권이 없으면 403으로 거부한다', async () => {
    // Given
    findUnique.mockResolvedValue({
      id: 'synthetic-actor',
      role: Role.STAFF,
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    const context = new ExecutionContextHost([{ sessionGithubId: 1004n }]);
    context.setType('http');

    // When / Then
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.STAFF_ONLY,
        status: 403,
      },
    });
  });

  it.each([Role.STUDENT, null])('%s 역할은 403으로 거부한다', async (role) => {
    // Given
    findUnique.mockResolvedValue({
      id: 'synthetic-actor',
      role,
      hasStaffAccess: null,
      hasAdminAccess: null,
      accountStatus: AccountStatus.ACTIVE,
    });
    const context = new ExecutionContextHost([{ sessionGithubId: 1002n }]);
    context.setType('http');

    // When
    const decision = guard.canActivate(context);

    // Then
    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.STAFF_ONLY,
        status: 403,
      },
    });
    try {
      await decision;
    } catch (error: unknown) {
      const message = readDomainMessage(error);
      expect(message).toContain('승인하거나 반려');
    }
  });

  it('비활성 STAFF 계정을 403으로 거부한다', async () => {
    // Given
    findUnique.mockResolvedValue({
      id: 'synthetic-actor',
      role: Role.STAFF,
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    const context = new ExecutionContextHost([{ sessionGithubId: 1003n }]);
    context.setType('http');

    // When
    const decision = guard.canActivate(context);

    // Then
    await expect(decision).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.STAFF_ONLY,
        status: 403,
      },
    });
  });
});

function readDomainMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('errorCode' in error)) {
    return '';
  }
  const code = error.errorCode;
  if (typeof code !== 'object' || code === null || !('message' in code)) {
    return '';
  }
  return typeof code.message === 'string' ? code.message : '';
}

describe('ApplicationsStaffListGuard', () => {
  const findUnique = jest.fn();
  const prisma = {
    user: { findUnique },
  };
  const guard = new ApplicationsStaffListGuard(prisma);

  beforeEach(() => findUnique.mockReset());

  it('학생은 generic 조회 403 으로 거부한다 (판정 문구 없음)', async () => {
    findUnique.mockResolvedValue({
      id: 'synthetic-student',
      role: Role.STUDENT,
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    const context = new ExecutionContextHost([{ sessionGithubId: 2001n }]);
    context.setType('http');

    try {
      await guard.canActivate(context);
      throw new Error('expected DomainException');
    } catch (error: unknown) {
      expect(error).toMatchObject({
        errorCode: {
          code: ApplicationsErrorCode.STAFF_LIST_ONLY,
          status: 403,
          message: '승인된 교직원 또는 관리자만 조회할 수 있습니다.',
        },
      });
      expect(readDomainMessage(error)).not.toContain('판정');
    }
  });

  it('ACTIVE STAFF 를 허용한다', async () => {
    findUnique.mockResolvedValue({
      id: 'synthetic-staff',
      role: null,
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    });
    const request: {
      sessionGithubId: bigint;
      applicationActorId?: string;
    } = { sessionGithubId: 2002n };
    const context = new ExecutionContextHost([request]);
    context.setType('http');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.applicationActorId).toBe('synthetic-staff');
  });
});
