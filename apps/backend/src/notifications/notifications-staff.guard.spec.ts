import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AccountStatus, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { NotificationsStaffGuard } from './notifications-staff.guard';

describe('NotificationsStaffGuard', () => {
  const findUnique = jest.fn();
  const guard = new NotificationsStaffGuard({
    user: { findUnique },
  });

  beforeEach(() => findUnique.mockReset());

  const contextFor = (githubId: bigint) =>
    new ExecutionContextHost([{ sessionGithubId: githubId }]);

  it('ACTIVE STAFF는 통과한다', async () => {
    findUnique.mockResolvedValue({
      id: 'staff',
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(guard.canActivate(contextFor(1n))).resolves.toBe(true);
  });

  it('ACTIVE ADMIN도 통과한다', async () => {
    findUnique.mockResolvedValue({
      id: 'admin',
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(guard.canActivate(contextFor(2n))).resolves.toBe(true);
  });

  it('STUDENT는 차단한다', async () => {
    findUnique.mockResolvedValue({
      id: 'student',
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
    });
    await expect(guard.canActivate(contextFor(3n))).rejects.toBeInstanceOf(
      DomainException,
    );
  });

  it('DEACTIVATED STAFF는 차단한다', async () => {
    findUnique.mockResolvedValue({
      id: 'staff',
      role: Role.STAFF,
      accountStatus: AccountStatus.DEACTIVATED,
    });
    await expect(guard.canActivate(contextFor(4n))).rejects.toBeInstanceOf(
      DomainException,
    );
  });

  it('미인증(사용자 없음)은 차단한다', async () => {
    findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(contextFor(5n))).rejects.toBeInstanceOf(
      DomainException,
    );
  });
});
