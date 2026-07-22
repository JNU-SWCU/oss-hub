import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AccountStatus, Role } from '@prisma/client';
import { ApplicationsStaffGuard } from './applications-staff.guard';
import { ApplicationsErrorCode } from './applications-error-code.enum';

describe('ApplicationsStaffGuard', () => {
  const findUnique = jest.fn();
  const prisma = {
    user: { findUnique },
  };
  const guard = new ApplicationsStaffGuard(prisma);

  beforeEach(() => findUnique.mockReset());

  it.each([Role.STAFF, Role.ADMIN])(
    '%s 역할을 허용하고 처리자 ID를 붙인다',
    async (role) => {
      // Given
      findUnique.mockResolvedValue({
        id: 'synthetic-actor',
        role,
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

  it.each([Role.STUDENT, null])('%s 역할은 403으로 거부한다', async (role) => {
    // Given
    findUnique.mockResolvedValue({
      id: 'synthetic-actor',
      role,
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
  });

  it('비활성 STAFF 계정을 403으로 거부한다', async () => {
    // Given
    findUnique.mockResolvedValue({
      id: 'synthetic-actor',
      role: Role.STAFF,
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
